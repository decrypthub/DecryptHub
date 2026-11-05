const str = { type: 'string' }, strings = { type: 'array', items: str, maxItems: 30 };
const tool = (name, description, properties, required, invoke) => ({ name, description,
  schema: { type: 'object', properties, required, additionalProperties: false },
  available: ctx => ctx.team?.snapshot().enabled === true || name === 'team_task_create' && ctx.team?.isLead(ctx),
  run: async (args, ctx) => ({ text: JSON.stringify(invoke(ctx.team, ctx, args)) }) });
export const TEAM_TOOLS = [
  tool('team_task_list', '列出团队共享任务、负责人、依赖和写入范围；任务变化不会自动唤醒成员。', {}, [], (team, ctx) => ({ tasks: team.list(ctx) })),
  tool('team_task_get', '读取共享任务的最新 revision，修改和执行前先读取。', { task_id: str }, ['task_id'], (team, ctx, a) => team.get(ctx, a.task_id)),
  tool('team_task_create', '需要多智能体协作时，由主代理创建共享任务并建立团队；无需用户切换模式。blocked_by 是前置任务 ID，write_scopes 仅提示路径重叠。创建任务不会启动成员，需委派并回收结果。', { subject: str, description: str, blocked_by: strings, write_scopes: strings }, ['subject', 'description'], (team, ctx, a) => team.create(ctx, a)),
  tool('team_task_update', '用最新 revision 领取、释放、编辑、完成或重新分配共享任务；只有主代理可以 reassign。', {
    task_id: str, expected_revision: { type: 'integer', minimum: 1 }, action: { type: 'string', enum: ['claim', 'release', 'edit', 'set_dependencies', 'complete', 'reopen', 'reassign', 'delete'] }, subject: str, description: str, blocked_by: strings, write_scopes: strings, owner: str,
  }, ['task_id', 'expected_revision', 'action'], (team, ctx, a) => team.update(ctx, a)),
];
