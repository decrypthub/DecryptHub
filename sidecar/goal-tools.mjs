// DSH-shaped goal operations. Host-attested human/round authority is supplied
// by the Session, never by model arguments or tool output.
import { createGoal } from './goals.mjs';

export function goalValue(goal) {
  if (!goal) return { goal: null };
  return { goal: { id: goal.id, revision: goal.revision,
    objective: goal.objective, phase: ({ needs_attention: 'blocked' })[goal.status] || goal.status,
    roundsStarted: goal.turns || 0, maxGoalRounds: goal.maxTurns || 256,
    ...(goal.status === 'needs_attention' ? { blockedReason: { code: goal.stopReason || 'blocked', message: goal.resumeNote || goal.summary || '需要处理' } } : {}) },
    activation: goal.status === 'active' ? 'armed' : 'disarmed' };
}
function roundCap(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw Error('max_goal_rounds 必须是正安全整数');
  return value;
}
export function applyGoalOperation(goal, input, { directHuman, goalRound, workspaceId, tokenBudget = 0 } = {}) {
  const human = () => { if (!directHuman) throw Error('此目标操作只能来自顶级会话中直接接纳的用户要求'); };
  if (input.operation === 'create') {
    human(); if (goal) throw Error('已有目标，请先读取并更新它，或由用户清除后创建');
    const next = createGoal(input.objective, workspaceId, tokenBudget);
    next.maxTurns = roundCap(input.max_goal_rounds ?? 256); next.revision = 1;
    return next;
  }
  if (!goal || input.goal_id !== goal.id || input.revision !== goal.revision) throw Error('目标 ID 或 revision 已过期，请先 get_goal 再更新');
  const action = input.action;
  if (['edit', 'pause', 'resume'].includes(action)) human();
  else if (!directHuman && !(goalRound && goal.status === 'active')) throw Error('结束目标需要直接用户要求或当前目标的有效接续轮次');
  let next = { ...goal, revision: goal.revision + 1 };
  if (action === 'edit') {
    if (input.objective === undefined && input.max_goal_rounds === undefined) throw Error('edit 至少提供 objective 或 max_goal_rounds');
    if (input.objective !== undefined) { const objective = String(input.objective).trim(); if (!objective || objective.length > 12000) throw Error('目标内容需要 1–12000 个字符'); next.objective = objective; }
    if (input.max_goal_rounds !== undefined) next.maxTurns = roundCap(input.max_goal_rounds);
  } else if (action === 'pause') next.status = 'paused';
  else if (action === 'resume') {
    if (goal.status === 'paused') throw Error('模型不能恢复用户暂停的目标，请用户在界面点击继续目标');
    if (goal.status === 'complete') throw Error('已完成的目标不能恢复');
    if (goal.turns >= (goal.maxTurns || 256)) throw Error('目标轮次已用尽，请先增加 max_goal_rounds');
    next.status = 'active'; next.stopReason = null; next.resumeNote = '';
  } else if (action === 'complete') { next.status = 'complete'; next.endedAt = Date.now(); }
  else if (action === 'blocked') {
    if (!String(input.blocked_reason || '').trim()) throw Error('blocked 必须填写 blocked_reason');
    if (!directHuman && goal.turns < 3) throw Error('至少经过 3 个目标接续轮次，才能自行报告持续阻塞；请先推进独立工作');
    next.status = 'needs_attention'; next.stopReason = 'model-reported'; next.resumeNote = String(input.blocked_reason).trim().slice(0, 12000);
  } else throw Error('未知目标操作');
  return next;
}
const tool = (name, description, properties, required, run) => ({ name, description,
  schema: { type: 'object', properties, required, additionalProperties: false }, run });
const str = { type: 'string' }, number = { type: 'number' };
export const GOAL_TOOLS = [
  tool('get_goal', '读取当前会话目标、ID、revision、轮次和状态；更新前先读取。', {}, [], async (_, ctx) => ({ text: JSON.stringify(goalValue(ctx.getGoal())) })),
  tool('create_goal', '为用户直接提出的长期任务建立持久目标并在多轮中持续推进。目标来自用户要求，不为单步任务创建；不提升权限。',
    { objective: str, max_goal_rounds: number }, ['objective'], async (args, ctx) => ({ text: JSON.stringify(ctx.goalOperation({ ...args, operation: 'create' })) })),
  tool('update_goal', '用准确 ID 与 revision 更新目标。edit/pause/resume 需要直接用户要求；complete/blocked 也可在当前目标接续轮次使用。用户暂停的目标须由用户恢复。',
    { goal_id: str, revision: number, action: { type: 'string', enum: ['edit', 'pause', 'resume', 'complete', 'blocked'] }, objective: str, max_goal_rounds: number, blocked_reason: str },
    ['goal_id', 'revision', 'action'], async (args, ctx) => ({ text: JSON.stringify(ctx.goalOperation(args)) })),
];
