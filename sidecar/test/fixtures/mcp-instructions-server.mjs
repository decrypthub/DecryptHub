// 最小的 MCP 服务：在 initialize 里返回 instructions，用来验证宿主不会把这段说明丢掉。
// 内容刻意写成 ADH 的形状（设备通道 + 归因纪律），但不代表真实 ADH 输出。
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const INSTRUCTIONS = 'DEVICE ACCESS: adb is the supported operator/AI channel. ATTRIBUTION: a stalled screen is not evidence of anti-debugging.';

const server = new Server(
  { name: 'instruction-fixture', version: '0.0.1' },
  { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: 'ping', description: '返回 pong', inputSchema: { type: 'object', properties: {} } }],
}));

server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: 'text', text: 'pong' }] }));

await server.connect(new StdioServerTransport());

export { INSTRUCTIONS };
