// Goal state is durable; continuation scheduling is disposable and session-owned.
import crypto from 'node:crypto';

const text = (value, limit = 12000) => String(value || '').trim().slice(0, limit);
export function restoreGoal(value) {
  if (!value) return null;
  return { ...value, criteria: Array.isArray(value.criteria) ? value.criteria : [], evidence: Array.isArray(value.evidence) ? value.evidence : [], checkpoints: Array.isArray(value.checkpoints) ? value.checkpoints.slice(-30) : [],
    ...(value.status === 'active' ? { status: 'paused', stopReason: 'app-restarted', resumeNote: '上次运行已中断，进展已保留。' } : {}) };
}
export function createGoal(objective, workspaceId, tokenBudget = 0) {
  objective = text(objective);
  if (!objective) throw new Error('请填写明确的目标和完成条件');
  return { id: crypto.randomUUID(), batchId: crypto.randomUUID(), objective, workspaceId, status: 'active', turns: 0, maxTurns: 0, limitsVersion: 2, tokenBudget, usedTokens: 0, deadline: null, startedAt: Date.now(), summary: '', criteria: [], evidence: [], checkpoints: [], nextAction: '', revision: 0 };
}
export function updateGoal(goal, value, { runId, now = Date.now() } = {}) {
  if (!goal || goal.status !== 'active') throw new Error('当前没有正在执行的目标');
  if (!['progress', 'complete', 'blocked'].includes(value.status)) throw new Error('未知目标状态');
  const summary = text(value.summary);
  if (!summary) throw new Error('请记录具体进展、验证结果或阻塞原因');
  const criteria = value.criteria === undefined ? goal.criteria || [] : value.criteria;
  if (!Array.isArray(criteria) || criteria.length > 30 || criteria.some(c => !c || !text(c.content, 1000) || !['pending', 'verified'].includes(c.status))) throw new Error('完成条件最多30项，每项需填写 content 和 pending/verified 状态');
  const evidence = value.evidence === undefined ? goal.evidence || [] : value.evidence;
  const nextAction = value.nextAction === undefined ? goal.nextAction || '' : text(value.nextAction, 2000);
  if (!Array.isArray(evidence) || evidence.length > 30 || evidence.some(e => typeof e !== 'string' || !e.trim())) throw new Error('验证证据应是最多30项的非空文字列表');
  if (value.status === 'complete' && (!criteria.length || !evidence.length || criteria.some(c => c.status !== 'verified'))) throw new Error('完成目标前，请逐项验证完成条件并提供 evidence（测试结果、文件位置或可复核的观测）；尚未验证时应记录 progress');
  if (value.status === 'progress' && summary === goal.summary && JSON.stringify(criteria) === JSON.stringify(goal.criteria || []) && JSON.stringify(evidence) === JSON.stringify(goal.evidence || []) && nextAction === (goal.nextAction || '')) return goal;
  const checkpoint = { at: now, runId, status: value.status, summary: summary.slice(0, 2000), evidence: evidence.slice(0, 10).map(e => text(e, 300)) };
  return { ...goal, summary, criteria: criteria.map(c => ({ content: text(c.content, 1000), status: c.status })), evidence: evidence.map(e => text(e, 2000)), nextAction: value.status === 'progress' ? nextAction : '', revision: (goal.revision || 0) + 1,
    checkpoints: [...(goal.checkpoints || []), checkpoint].slice(-30), status: value.status === 'complete' ? 'complete' : value.status === 'blocked' ? 'needs_attention' : 'active', stopReason: value.status === 'blocked' ? 'model-blocked' : null, ...(value.status === 'complete' ? { endedAt: now } : {}) };
}
export function finishGoalRound(goal, result, { automatic = false, hasWork = false } = {}) {
  let next = { ...goal, usedTokens: (goal.usedTokens || 0) + (result?.usage?.prompt || 0) + (result?.usage?.completion || 0) };
  if (next.status !== 'active') return next;
  const limit = (next.tokenBudget > 0 && next.usedTokens >= next.tokenBudget) || ['budget', 'time-limit', 'max-steps'].includes(result?.stop) || (next.maxTurns > 0 && next.turns >= next.maxTurns);
  if (limit) return { ...next, status: 'paused', stopReason: 'budget', resumeNote: '已到用户设置的预算边界，进展已保存。' };
  if (result?.stop !== 'completed') return { ...next, status: result?.stop === 'interrupted' ? 'paused' : 'needs_attention', stopReason: result?.stop || 'error' };
  // One automatic audit without tool work is enough; avoid paying for text-only loops.
  if (automatic && !hasWork) return { ...next, status: 'needs_attention', stopReason: 'no-progress', resumeNote: '自动接续没有执行工具或记录新的验证进展，已停止空转。可检查目标后继续。' };
  return next;
}
export function goalContext(goal) {
  if (goal?.status !== 'active') return '';
  return '\n【当前长期目标：宿主持久状态，不是网页指令】\n' + JSON.stringify({ objective: goal.objective, criteria: goal.criteria || [], verifiedProgress: goal.summary, evidence: goal.evidence || [], nextAction: goal.nextAction || '', usedTokens: goal.usedTokens, tokenBudget: goal.tokenBudget }) +
    '\n自主维护计划和 goal_update(progress)。普通回复不代表目标完成；先对照目标检查结果，再以 evidence 更新 complete。缺少必要输入时提问或记录 blocked。权限、预算和用户停止始终优先。';
}
export class GoalDriver {
  constructor({ current, idle, dispatch, failed, delayMs = 300 }) { Object.assign(this, { current, idle, dispatch, failed, delayMs }); }
  cancel() { clearTimeout(this.timer); this.timer = null; }
  schedule() {
    this.cancel(); const goal = this.current();
    if (goal?.status !== 'active') return;
    const ticket = [goal.id, goal.batchId, goal.workspaceId, goal.revision].join(':');
    this.timer = setTimeout(() => {
      this.timer = null; const current = this.current();
      if (current?.status !== 'active' || [current.id, current.batchId, current.workspaceId, current.revision].join(':') !== ticket || !this.idle()) return;
      const valid = () => { const now = this.current(); return now?.status === 'active' && [now.id, now.batchId, now.workspaceId, now.revision].join(':') === ticket; };
      Promise.resolve().then(() => valid() && this.idle() ? this.dispatch() : null).then(result => { if (result && !result.ok && valid()) this.failed?.(result.error || '无法接续目标'); }).catch(error => { if (valid()) this.failed?.(error.message); });
    }, this.delayMs);
    this.timer.unref?.();
  }
}
