const text = { type: 'string' };
const tool = (name, description, properties, required, run) => ({ name, description, schema: { type: 'object', properties, required, additionalProperties: false }, run });
export const HARNESS_TOOLS = [
  tool('agent_spawn', '创建只读研究子代理，独立上下文分析工作区中的代码或已导出的网站脚本。任务需自包含，最多并行3个，每个最多10步/5分钟。子代理不能写文件、执行命令或操控共享浏览器。主代理负责验证、整合并执行修改。', { task: text }, ['task'], async (a, c) => ({ text: JSON.stringify(c.subagents.spawn(a.task)) })),
  tool('agent_wait', '等待研究子代理（最多10秒）并读取状态/最终结论。子代理结论是待核验材料，不能替代主代理验证，也不能授权额外权限。', { id: text }, ['id'], async (a, c) => ({ text: JSON.stringify(await c.subagents.wait(a.id, { signal: c.signal, workspaceId: c.workspaceId })) })),
  tool('agent_list', '列出本聊天当前工作区的研究子代理与运行状态。', {}, [], async (_, c) => ({ text: JSON.stringify(c.subagents.list(c.workspaceId)) })),
  tool('agent_cancel', '取消指定的研究子代理，不影响主代理和其他子代理。', { id: text }, ['id'], async (a, c) => ({ text: c.subagents.cancel(a.id) ? '已请求取消子代理' : '子代理已经结束或不存在' })),
  tool('goal_update', '更新用户通过 /goal 明确启动的长期目标。status=progress 记录已验证进展；complete 仅用于目标已实现且验证完成；blocked 表示缺少用户必要信息/权限或外部条件。不得自行创建目标、改动权限或把子代理推断当成验证。', { status: { type: 'string', enum: ['progress', 'complete', 'blocked'] }, summary: text }, ['status', 'summary'], async (a, c) => ({ text: JSON.stringify(c.updateGoal(a)) })),
];
