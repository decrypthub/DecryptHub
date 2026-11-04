import { toolInput } from './session-query-input.mjs';
const target = toolInput.targetSessionParameter;
const paging = { limit: { type: 'integer', minimum: 1, maximum: 100 }, cursor: { type: 'string', description: '上页 nextCursor；保持检索词、过滤条件及 limit 不变。相关历史变化时重新开始。' } };
function jsonSchema(fields) {
  const required = Object.entries(fields).filter(([, value]) => value.required).map(([key]) => key);
  return { type: 'object', properties: Object.fromEntries(Object.entries(fields).map(([key, value]) => { const { required, ...schema } = value; return [key, schema]; })), required, additionalProperties: false };
}
const tool = (name, description, fields, method, single) => ({ name, description, schema: jsonSchema(fields), run: async (args, ctx) => {
  try {
    if (!ctx.sessionQuery) throw Error('当前没有会话查询服务');
    return { text: JSON.stringify(await ctx.sessionQuery[method](ctx, args, single)) };
  } catch (error) { return { text: (error.code ? `[${error.code}] ` : '') + error.message, isError: true }; }
} });
export const SESSION_QUERY_TOOLS = [
  tool('session_search', '检索相同工作目录下的历史会话，每个会话返回最相关的一条事件。排除当前会话；结果有稳定 sessionId/seq。每页最多 100 项，有 nextCursor 时可继续取下一页。', { ...toolInput.sessionSearchParameters, ...paging }, 'search', false),
  tool('session_event_search', '检索一个已授权会话的历史事件，默认当前会话。自身检索排除执行本工具的当前模型步骤。推理、原生回放、运行环境和凭据不参与全文检索。用 nextCursor 继续分页。', { ...toolInput.eventSearchParameters, ...paging }, 'search', true),
  tool('session_trace', '读取同一工作目录中可见的父会话、分支和子代理关系；遇到不可见祖先会明确报告边界，不伪装成完整链路。', target, 'traceSession'),
  tool('session_event_trace', '追溯事件当前是否仍在模型上下文、被哪次摘要替代，以及完整的替换链与来源事件。', { ...target, seq: { type: 'integer', required: true } }, 'traceEvent'),
  tool('session_event_read', '完整读取一个原始事件，并可附带前后事件摘要。序号不因压缩改变；只读观察不会启动被查询会话的 Agent。', { ...target, seq: { type: 'integer', required: true }, before: { type: 'integer' }, after: { type: 'integer' } }, 'readEvent'),
];
