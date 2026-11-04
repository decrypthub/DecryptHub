import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { History } from '../history.mjs';
import { resolveProvider } from '../providers/index.mjs';
import { toPiContext } from '../providers/pi-ai.mjs';
import { toAnthropicMessages } from '../providers/anthropic.mjs';

function events(res, values) { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(values.map(value => 'data: ' + JSON.stringify(value) + '\n\n').join('')); }
function completed(id, output) { return { type: 'response.completed', response: { id, status: 'completed', model: 'fixture', output,
  usage: { input_tokens: 20, output_tokens: 10, input_tokens_details: { cached_tokens: 5 }, output_tokens_details: { reasoning_tokens: 4 } } } }; }
function finish(res) {
  const item = { id: 'msg_2', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'done', annotations: [] }] };
  events(res, [{ type: 'response.created', response: { id: 'resp_2' } }, { type: 'response.output_item.added', output_index: 0, item: { ...item, content: [] } },
    { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'done' }, { type: 'response.output_item.done', output_index: 0, item }, completed('resp_2', [item])]);
}
async function serve(t, handler) {
  const server = http.createServer(async (req, res) => { let data = ''; for await (const chunk of req) data += chunk; handler(req, res, JSON.parse(data)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  return 'http://127.0.0.1:' + server.address().port + '/v1';
}
test('DSH pi-ai engine performs a real Responses tool loop with encrypted reasoning, exact effort and durable replay', async t => {
  const bodies = [], deltas = [];
  const baseUrl = await serve(t, (req, res, body) => {
    assert.equal(req.url, '/v1/responses'); bodies.push(body);
    if (bodies.length > 1) return finish(res);
    const thinking = { id: 'rs_1', type: 'reasoning', encrypted_content: 'encrypted-proof', summary: [{ type: 'summary_text', text: 'inspect' }] };
    const call = { id: 'fc_1', type: 'function_call', call_id: 'call_1', name: 'probe', arguments: '{"value":1}', status: 'completed' };
    events(res, [{ type: 'response.created', response: { id: 'resp_1' } },
      { type: 'response.output_item.added', output_index: 0, item: { ...thinking, summary: [] } },
      { type: 'response.reasoning_summary_text.delta', output_index: 0, delta: 'inspect' },
      { type: 'response.output_item.done', output_index: 0, item: thinking },
      { type: 'response.output_item.added', output_index: 1, item: { ...call, arguments: '' } },
      { type: 'response.function_call_arguments.delta', output_index: 1, delta: '{"value":1}' },
      { type: 'response.output_item.done', output_index: 1, item: call }, completed('resp_1', [thinking, call])]);
  });
  const settings = { provider: 'openai', activeProviderId: 'route-one', activeThinking: 'high', openai: { api: 'openai-responses', baseUrl, model: 'fixture', apiKey: 'fixture',
    thinking: { transport: 'effort', levels: ['high'], default: 'high', wireValues: { high: 'vendor-high' } } } };
  const provider = resolveProvider(settings), result = await provider.complete([{ role: 'user', content: 'inspect' }], [{ name: 'probe', schema: { type: 'object', properties: { value: { type: 'number' } } } }], { onReasoning: delta => deltas.push(delta) });
  assert.equal(bodies[0].reasoning.effort, 'vendor-high'); assert.equal(bodies[0].store, false); assert.equal(bodies[0].messages, undefined);
  assert.deepEqual(result.toolCalls[0].args, { value: 1 }); assert.ok(deltas.join('').includes('inspect'));
  const history = new History({ system: 'system' }); history.append({ t: 'user', content: 'inspect' });
  history.append({ t: 'assistant', content: result.content, reasoning: result.reasoning, calls: result.toolCalls, nativeReplay: result.nativeReplay });
  history.append({ t: 'tool', id: result.toolCalls[0].id, name: 'probe', content: 'observed' });
  const restored = History.fromJSON(history.toJSON());
  const second = await provider.complete(restored.view(), [], {}); assert.equal(second.content, 'done');
  assert.ok(bodies[1].input.some(item => item.type === 'reasoning' && item.encrypted_content === 'encrypted-proof'));
  assert.ok(bodies[1].input.some(item => item.type === 'function_call_output' && item.call_id === 'call_1'));
  const foreign = toAnthropicMessages(restored.view(), 'claude', 'https://other.invalid').messages;
  assert.equal(foreign.find(m => m.role === 'assistant').content.find(part => part.type === 'tool_use').id, 'call_1');
  assert.equal(foreign.findLast(m => m.role === 'user').content[0].tool_use_id, 'call_1');
  await resolveProvider({ ...settings, activeProviderId: 'different-route' }).complete(restored.view(), [], {});
  assert.ok(!JSON.stringify(bodies[2]).includes('encrypted-proof'));
});

test('Responses SDK makes one physical request per host attempt and preserves 429 status', async t => {
  let requests = 0;
  const baseUrl = await serve(t, (_, res) => { requests++; res.writeHead(429); res.end('{"error":{"message":"fixture rate limit"}}'); });
  const provider = resolveProvider({ provider: 'openai', openai: { api: 'openai-responses', baseUrl, apiKey: 'fixture', model: 'fixture' } });
  await assert.rejects(provider.complete([{ role: 'user', content: 'hello' }], [], { managedRetry: true }), error => error.status === 429);
  assert.equal(requests, 1);
});

test('Responses context preserves image tool results and error state through native projection', () => {
  const converted = toPiContext([{ role: 'tool', tool_call_id: 'call_1', name: 'probe', _toolError: true,
    content: [{ type: 'text', text: 'failure screenshot' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } }] }], [], {});
  assert.equal(converted.messages[0].isError, true); assert.equal(converted.messages[0].content[1].data, 'AQID');
});
