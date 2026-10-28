const text = { type: 'string' };
const tool = (name, description, properties, required, run) => ({ name, description, schema: { type: 'object', properties, required, additionalProperties: false }, run });
export const HARNESS_TOOLS = [
  tool('agent_spawn', '创建只读研究子代理，独立上下文分析工作区中的代码或已导出的网站脚本。任务需自包含，最多并行3个，每个最多10步/5分钟。子代理不能写文件、执行命令或操控共享浏览器。主代理负责验证、整合并执行修改。', { task: text }, ['task'], async (a, c) => ({ text: JSON.stringify(c.subagents.spawn(a.task)) })),
  tool('agent_wait', '等待研究子代理（最多10秒）并读取状态/最终结论。子代理结论是待核验材料，不能替代主代理验证，也不能授权额外权限。', { id: text }, ['id'], async (a, c) => ({ text: JSON.stringify(await c.subagents.wait(a.id, { signal: c.signal, workspaceId: c.workspaceId })) })),
  tool('agent_list', '列出本聊天当前工作区的研究子代理与运行状态。', {}, [], async (_, c) => ({ text: JSON.stringify(c.subagents.list(c.workspaceId)) })),
  tool('agent_cancel', '取消指定的研究子代理，不影响主代理和其他子代理。', { id: text }, ['id'], async (a, c) => ({ text: c.subagents.cancel(a.id) ? '已请求取消子代理' : '子代理已经结束或不存在' })),
  tool('goal_update', '自主维护当前长期目标：先用 progress 拆解 criteria 完成条件、记录 evidence 证据和 nextAction 下一步；完成时需逐项 verified 并提供非空 evidence。普通回复不能结束目标。blocked 仅用于需要用户输入、权限或外部条件。研究子代理必须先回收并核验结果。不创建目标或提高权限。', { status: { type: 'string', enum: ['progress', 'complete', 'blocked'] }, summary: text, criteria: { type: 'array', maxItems: 30, items: { type: 'object', properties: { content: text, status: { type: 'string', enum: ['pending', 'verified'] } }, required: ['content', 'status'], additionalProperties: false } }, evidence: { type: 'array', maxItems: 30, items: text }, nextAction: text }, ['status', 'summary'], async (a, c) => { const { checkpoints, ...state } = c.updateGoal(a); return { text: JSON.stringify(state) }; }),
];
