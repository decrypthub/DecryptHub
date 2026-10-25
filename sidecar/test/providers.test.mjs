// Provider 适配器：用本地假 SSE 服务端验证两个 adapter 的解析、重试与 usage 归一化。
// 不依赖外网，也不依赖 sidecar 的重依赖（只 import ./providers/*）。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { resolveProvider } from '../providers/index.mjs';
import { toAnthropicMessages } from '../providers/anthropic.mjs';
import { normalizeCalls } from '../providers/openai.mjs';

/** 起一个只回放预设 SSE 的本地服务；handler(req, body, res) 可自定义状态码 */
async function serve(handler) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => (body += d));
    req.on('end', () => handler(req, body ? JSON.parse(body) : null, res));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise(r => server.close(r)) };
}
function sse(res, events, status = 200) {
  res.writeHead(status, { 'Content-Type': 'text/event-stream' });
  for (const e of events) res.write(`data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n`);
  res.end();
}

const openaiCfg = url => ({ provider: 'openai', temperature: 0, openai: { baseUrl: url + '/v1', apiKey: 'k', model: 'm', retryBaseMs: 5 } });
const anthropicCfg = url => ({ provider: 'anthropic', temperature: 0, anthropic: { baseUrl: url, apiKey: 'k', model: 'claude-x', maxTokens: 100, retryBaseMs: 5 } });

const ok = (o, extra = {}) => ({ choices: [{ delta: o, ...(extra.finish ? { finish_reason: extra.finish } : {}) }], ...(extra.usage ? { usage: extra.usage } : {}) });

test('DeepSeek title metadata disables thinking without changing normal task requests', async () => {
  const bodies = [], srv = await serve((_req, body, res) => { bodies.push(body); sse(res, [ok({ content: '登录签名分析' }), '[DONE]']); });
  try {
    const settings = openaiCfg(srv.url); settings.openai.model = 'deepseek-v4.1-flash';
    await resolveProvider({ ...settings, openai: { ...settings.openai, requestPurpose: 'session-title' }, openaiMaxTokens: 256 }).complete([{ role: 'user', content: 'title' }], [], {});
    await resolveProvider(settings).complete([{ role: 'user', content: 'task' }], [], {});
    assert.deepEqual(bodies[0].thinking, { type: 'disabled' }); assert.equal(bodies[0].max_tokens, 256); assert.equal(bodies[1].thinking, undefined);
  } finally { await srv.close(); }
});

test('openai: content + reasoning + tool_calls 增量拼装 + usage', async () => {
  const srv = await serve((req, body, res) => {
    assert.equal(new URL(req.url, 'http://x').pathname, '/v1/chat/completions');
    assert.equal(body.stream, true);
    assert.equal(body.tools[0].function.name, 'net_list');
    sse(res, [
      ok({ reasoning_content: '想一想' }),
      ok({ content: '你' }),
      ok({ content: '好' }),
      ok({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'net_list', arguments: '{"has' } }] }),
      ok({ tool_calls: [{ index: 0, function: { arguments: 'Sig":true}' } }] }),
      ok({}, { finish: 'tool_calls', usage: { prompt_tokens: 1200, completion_tokens: 30 } }),
    ]);
  });
  try {
    const p = resolveProvider(openaiCfg(srv.url));
    const r = await p.complete([{ role: 'user', content: 'hi' }], [{ name: 'net_list', description: 'd', schema: { type: 'object' } }], {});
    assert.equal(r.content, '你好');
    assert.equal(r.reasoning, '想一想');
    assert.equal(r.finishReason, 'tool_calls');
    assert.deepEqual(r.toolCalls[0].args, { hasSig: true });
    assert.equal(r.usage.prompt_tokens, 1200);
  } finally { await srv.close(); }
});

test('openai: 5xx 无输出时重试，第二次成功', async () => {
  let n = 0;
  const srv = await serve((req, body, res) => {
    if (n++ === 0) { res.writeHead(503); res.end('{"error":"busy"}'); return; }
    sse(res, [ok({ content: 'ok' }, { finish: 'stop' })]);
  });
  try {
    const p = resolveProvider(openaiCfg(srv.url));
    const r = await p.complete([{ role: 'user', content: 'hi' }], [], {});
    assert.equal(r.content, 'ok');
    assert.equal(n, 2);
  } finally { await srv.close(); }
});

test('openai: 400 不重试，直接抛出（带状态码）', async () => {
  const srv = await serve((req, body, res) => { res.writeHead(400); res.end('bad request'); });
  try {
    const p = resolveProvider(openaiCfg(srv.url));
    await assert.rejects(() => p.complete([{ role: 'user', content: 'hi' }], [], {}), e => e.status === 400 && /HTTP 400/.test(e.message));
  } finally { await srv.close(); }
});

test('anthropic: usage/stop_reason/tool_use 归一化成 OpenAI 形状', async () => {
  const srv = await serve((req, body, res) => {
    assert.equal(new URL(req.url, 'http://x').pathname, '/v1/messages');
    assert.equal(body.system, 'SYS');
    assert.equal(body.tools[0].input_schema.type, 'object');
    sse(res, [
      { type: 'message_start', message: { usage: { input_tokens: 4321, cache_read_input_tokens: 100 } } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '答' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '案' } },
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu1', name: 'net_get' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"id":' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"r1"}' } },
      { type: 'content_block_stop', index: 1 },
      { type: 'message_delta', usage: { output_tokens: 77 }, delta: { stop_reason: 'tool_use' } },
    ]);
  });
  try {
    const p = resolveProvider(anthropicCfg(srv.url));
    const r = await p.complete([{ role: 'system', content: 'SYS' }, { role: 'user', content: 'hi' }], [{ name: 'net_get', description: 'd', schema: { type: 'object', properties: {} } }], {});
    assert.equal(r.content, '答案');
    assert.equal(r.finishReason, 'tool_use');
    assert.deepEqual(r.toolCalls[0].args, { id: 'r1' });
    assert.equal(r.usage.prompt_tokens, 4321);
    assert.equal(r.usage.completion_tokens, 77);
    assert.equal(r.usage.prompt_tokens_details.cached_tokens, 100);
  } finally { await srv.close(); }
});

test('anthropic: 500 后重试成功；400 立即失败', async () => {
  let n = 0;
  const srv = await serve((req, body, res) => {
    if (n++ === 0) { res.writeHead(500); res.end('boom'); return; }
    sse(res, [{ type: 'message_start', message: { usage: { input_tokens: 10 } } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } }]);
  });
  try {
    const p = resolveProvider(anthropicCfg(srv.url));
    const r = await p.complete([{ role: 'user', content: 'hi' }], [], {});
    assert.equal(r.content, 'ok');
    assert.equal(n, 2);
  } finally { await srv.close(); }
  const bad = await serve((req, body, res) => { res.writeHead(400); res.end('no'); });
  try {
    const p = resolveProvider(anthropicCfg(bad.url));
    await assert.rejects(() => p.complete([{ role: 'user', content: 'hi' }], [], {}), e => e.status === 400);
  } finally { await bad.close(); }
});

test('toAnthropicMessages: system 提取、tool 结果转 block、空文本跳过', () => {
  const { system, messages } = toAnthropicMessages([
    { role: 'system', content: 'S1' },
    { role: 'user', content: 'u1' },
    { role: 'assistant', content: '', tool_calls: [{ id: 't1', function: { name: 'x', arguments: '{"a":1}' } }] },
    { role: 'tool', tool_call_id: 't1', name: 'x', content: 'R' },
    { role: 'assistant', content: '' },
  ]);
  assert.equal(system, 'S1');
  assert.equal(messages.length, 3);
  assert.deepEqual(messages[1].content[0], { type: 'tool_use', id: 't1', name: 'x', input: { a: 1 } });
  assert.deepEqual(messages[2].content[0], { type: 'tool_result', tool_use_id: 't1', content: 'R' });
});

test('toAnthropicMessages: 首条纯 assistant（压缩确认）被丢掉，带 tool_use 的保留', () => {
  const a = toAnthropicMessages([{ role: 'assistant', content: '已了解' }, { role: 'user', content: 'u' }]);
  assert.deepEqual(a.messages, [{ role: 'user', content: 'u' }]);
  const b = toAnthropicMessages([{ role: 'assistant', content: '', tool_calls: [{ id: 't', function: { name: 'n', arguments: '{}' } }] }, { role: 'tool', tool_call_id: 't', content: 'r' }]);
  assert.equal(b.messages[0].role, 'assistant');
});

test('normalizeCalls: 非法 JSON 参数不抛错，标 argError 回喂模型', () => {
  const calls = normalizeCalls({ 0: { name: 'n', args: '{bad' }, 1: { name: '', args: '' } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].argError != null, true);
  assert.match(calls[0].argError, /不是合法 JSON/);
});

test('resolveProvider: 缺 key 抛中文提示；provider 缺省为 openai', () => {
  assert.throws(() => resolveProvider({ provider: 'openai', openai: {} }), /尚未配置 API Key/);
  const p = resolveProvider({ provider: undefined, openai: { apiKey: 'k', baseUrl: 'http://x', model: 'm' } });
  assert.equal(p.id, 'openai');
});
