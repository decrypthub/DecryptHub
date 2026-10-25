// 最小 MCP 服务，用于端到端验证「设置 → MCP 服务」与工具调用（不依赖网络）。
// 用法：node sidecar/test/fixtures/mcp-demo-server.mjs （stdio）
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server({ name: 'demo-tools', version: '1.0.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: 'echo', description: '原样返回输入文本，用于验证 MCP 通路', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
    { name: 'now', description: '返回当前时间（ISO 8601）', inputSchema: { type: 'object', properties: {} } },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async req => {
  const { name, arguments: args } = req.params || {};
  if (name === 'echo') return { content: [{ type: 'text', text: 'echo: ' + String(args?.text ?? '') }] };
  if (name === 'now') return { content: [{ type: 'text', text: new Date().toISOString() }] };
  return { content: [{ type: 'text', text: 'unknown tool: ' + name }], isError: true };
});

await server.connect(new StdioServerTransport());
