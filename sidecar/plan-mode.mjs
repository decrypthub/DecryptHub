// Collaboration state, independent of filesystem/execution permission.
// DSH plan-mode/src/index.ts: select -> next accepted step -> durable mode;
// exit_plan_mode approval changes the next step, not the rest of a tool batch.
export const PLAN_POLICY = `【计划模式】当前与用户一起研究和制定计划。先调查现有实现、澄清必要信息，形成可执行且有验收方式的计划。此阶段不要开始实施用户尚未批准的方案。计划模式不改变工具权限，权限仍由宿主独立判断。计划完成后调用 exit_plan_mode 提交完整 Markdown 计划，批准后从下一步开始实施；用户选择继续规划或未明确批准时保持计划模式。`;

export class PlanMode {
  constructor(value, changed = () => {}) {
    this.active = value?.active === true;
    this.entered = value?.entered === true || this.active;
    this.pending = typeof value?.pending === 'boolean' ? value.pending : null;
    this.revision = Number.isSafeInteger(value?.revision) && value.revision >= 0 ? value.revision : 0;
    this.changed = changed;
  }
  snapshot() { return { active: this.active, pending: this.pending, entered: this.entered, revision: this.revision }; }
  select(active, { running = false } = {}) {
    if (typeof active !== 'boolean') throw Error('计划状态必须是布尔值');
    if (active === (this.pending ?? this.active)) return this.snapshot();
    const previous = this.snapshot();
    if (running) this.pending = active === this.active ? null : active;
    else { this.active = active; this.pending = null; this.entered ||= active; }
    this.revision++;
    try { this.changed(this.snapshot(), !running); }
    catch (error) { Object.assign(this, previous); throw error; }
    return this.snapshot();
  }
  boundary() {
    if (this.pending === null) return;
    const previous = this.snapshot();
    this.active = this.pending; this.pending = null; this.entered ||= this.active;
    this.revision++;
    try { this.changed(this.snapshot(), true); }
    catch (error) { Object.assign(this, previous); throw error; }
  }
  async review(plan, { ask, signal } = {}) {
    if (!this.active) throw Error('exit_plan_mode 只能在计划模式使用');
    if (typeof plan !== 'string' || !/^#\s+\S/.test(plan.trim())) throw Error('请提供以 # 标题开头的完整 Markdown 计划');
    if (!ask) throw Error('当前没有可用的计划确认界面，请用户用 /plan off 退出');
    const answer = await ask({ kind: 'plan', question: '批准这份计划并开始实施？', detail: plan,
      options: ['批准计划并实施', '继续规划'] });
    signal?.throwIfAborted();
    if (['skipped', 'cancelled', 'timed-out'].includes(answer?.status)) return {
      text: JSON.stringify({ approved: false, guidance: '用户未确认计划，计划模式保持开启，结束本轮等待用户继续。' }), concludeTurn: true,
    };
    if (answer?.status !== 'answered' || answer.answer?.trim() !== '批准计划并实施')
      return { text: JSON.stringify({ approved: false, feedback: answer?.answer || '', guidance: '计划模式保持开启。用户未明确批准，不要开始实施；根据反馈修订计划。' }) };
    // Do not switch the current batch midway through execution.
    this.select(false, { running: true });
    return { text: JSON.stringify({ approved: true, guidance: '计划已批准，从下一步退出计划模式并开始实施。' }) };
  }
}

export const PLAN_TOOLS = [{
  name: 'exit_plan_mode', description: '仅在计划模式中使用。向用户提交完整计划并等待明确批准；批准后从下一步退出计划模式实施，未批准则继续规划。',
  schema: { type: 'object', properties: { plan: { type: 'string', description: '以 # 标题开头的完整 Markdown 计划' } }, required: ['plan'], additionalProperties: false },
  available: ctx => !!(ctx.getPlan?.().active || ctx.getPlan?.().entered),
  run: (args, ctx) => ctx.planMode.review(args.plan, { ask: ctx.ask, signal: ctx.signal }),
}];
