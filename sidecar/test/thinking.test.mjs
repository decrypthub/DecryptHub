// 思考强度：声明归一、发送片段、请求装配、持久化边界。
//
// 重点不是「参数有没有传出去」，而是三条容易踩的边界：
//   1) 模型没声明档位时绝不能凭空发送思考参数（那是在替用户决定花钱）；
//   2) 会话标题这类元数据请求永远不花思考预算（DeepSeek V4 会因此输出空标题）；
//   3) 声明与实际请求必须一致，界面上写着「支持 high」，请求里就必须真发 high。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {
  THINKING_LEVELS, THINKING_TRANSPORTS, ALL_LEVELS, normalizeThinking, normalizeThinkingLevels,
  levelsLabel, levelLabel, inferThinking, modelThinking, declaredThinking, effectiveThinking, requestThinking,
  reasoningEffort, thinkingBudget, openAIThinking, anthropicThinking, isThinkingLevel, deriveTransport,
} from '../thinking.mjs';
import { resolveProvider } from '../providers/index.mjs';

test('档位表照 DSH 规范序，且发送值一一对应', () => {
  // 顺序与集合都对齐 DeepSeek Harness 的 pi-ai 目录（off → minimal → low → medium → high → xhigh → max），
  // 不自造词表，也不为了「看起来简洁」删档：声明里能写什么，界面就必须能表达什么。
  assert.deepEqual(ALL_LEVELS, ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(THINKING_LEVELS.map(l => l.id), ALL_LEVELS);
  for (const level of THINKING_LEVELS) {
    // 关闭档没有发送值：它表示「不要这个参数」，不是某个更小的值。
    if (level.id === 'off') { assert.equal(reasoningEffort(level.id), null); assert.equal(thinkingBudget(level.id), null); continue; }
    assert.ok(reasoningEffort(level.id), level.id + ' 缺少 reasoning_effort');
    assert.ok(thinkingBudget(level.id) >= 1024, level.id + ' 的思考预算必须 ≥ 1024');
  }
  for (const id of ALL_LEVELS) assert.ok(levelLabel(id).length > 0, id + ' 缺少英文标签');
  assert.equal(levelLabel('xhigh'), 'XHigh');
  assert.deepEqual(THINKING_TRANSPORTS.map(t => t.id), ['effort', 'budget', 'switch', 'none']);
});

test('声明归一：档位去重排序、未知值丢弃、默认档必须落在声明范围内', () => {
  assert.deepEqual(normalizeThinkingLevels(['high', 'off', 'high', 'bogus']), ['off', 'high']);
  assert.deepEqual(normalizeThinkingLevels('medium'), ['medium']);
  assert.deepEqual(normalizeThinkingLevels(undefined), []);
  assert.equal(levelsLabel(['off', 'high']), 'Off / High');

  // 默认档不在声明里：回落到 medium，再回落到第一项，绝不留下矛盾配置。
  assert.equal(normalizeThinking({ levels: ['low', 'medium'], default: 'high' }).default, 'medium');
  assert.equal(normalizeThinking({ levels: ['off', 'low'], default: 'high' }).default, 'off');
  assert.equal(normalizeThinking({ levels: [] }).default, '');
  // 发送方式兜底：非法值回落到调用方给的默认值。
  assert.equal(normalizeThinking({ levels: [], transport: 'nope' }, 'budget').transport, 'budget');
  assert.equal(normalizeThinking({ transport: 'switch' }).transport, 'switch');
});

test('未声明时按模型名推断，认不出来就如实声明「不发送」', () => {
  assert.equal(inferThinking('claude-sonnet-4-5').transport, 'budget');
  // 推断只给「基础档」：xhigh / max 是可选档，DSH 也只在模型显式映射时才提供，
  // 按名字猜会把端点不认的 reasoning_effort 发出去。
  assert.deepEqual(inferThinking('claude-sonnet-4-5').levels, ['off', 'minimal', 'low', 'medium', 'high']);
  assert.equal(inferThinking('gpt-5.1').transport, 'effort');
  assert.deepEqual(inferThinking('gpt-5.1').levels, ['off', 'minimal', 'low', 'medium', 'high']);
  assert.equal(inferThinking('o3-mini').transport, 'effort');
  const ds = inferThinking('deepseek-v4.1-flash');
  assert.equal(ds.transport, 'switch'); assert.deepEqual(ds.levels, ['off', 'high']);
  // 老模型 / 未知模型：不假装支持，避免请求被 400。
  const legacy = inferThinking('gpt-4o');
  assert.equal(legacy.transport, 'none'); assert.equal(legacy.default, '');
});

test('可选档（xhigh / max）只来自模型显式声明，推断不会带出来', () => {
  const declared = normalizeThinking({ levels: ['off', 'high', 'xhigh', 'max'], default: 'xhigh', transport: 'effort' });
  assert.deepEqual(declared.levels, ['off', 'high', 'xhigh', 'max']);
  assert.equal(levelLabel(declared.default), 'XHigh');
  assert.equal(reasoningEffort('max'), 'max');
  assert.equal(thinkingBudget('xhigh'), 32000);
  // 显式声明时，用户在界面上选到的「极高」必须真的发出去。
  assert.deepEqual(openAIThinking({ transport: 'effort', level: 'xhigh' }), [{ field: 'reasoning_effort', value: 'xhigh' }]);
});

test('生效档位：用户选择优先，越界回落到模型默认，再回落到「不发」', () => {
  const declared = normalizeThinking({ levels: ['off', 'medium'], default: 'medium', transport: 'effort' });
  assert.deepEqual(effectiveThinking(declared, 'off'), { transport: 'effort', level: 'off' });
  assert.deepEqual(effectiveThinking(declared, 'high'), { transport: 'effort', level: 'medium' });
  assert.deepEqual(effectiveThinking(normalizeThinking({ levels: [], transport: 'none' }), 'high'), { transport: 'none', level: '' });
});

test('模型显式声明优先于推断；声明为空才推断', () => {
  const declared = normalizeThinking({ levels: ['low'], default: 'low', transport: 'effort' });
  assert.deepEqual(modelThinking(declared, 'claude-sonnet-4-5').levels, ['low']);
  assert.equal(modelThinking(declared, 'claude-sonnet-4-5').transport, 'effort');
  assert.equal(modelThinking(undefined, 'claude-sonnet-4-5').transport, 'budget');
  assert.equal(modelThinking({ levels: [] }, 'gpt-5').transport, 'effort');
});

test('OpenAI 片段：effort 发强度名、switch 发开关加强度、none 什么都不发', () => {
  assert.deepEqual(openAIThinking({ transport: 'effort', level: 'high' }), [{ field: 'reasoning_effort', value: 'high' }]);
  // 开关型端点要两个字段：thinking.type 负责「开」，reasoning_effort 负责「开多大」。
  // 只发前者会把 low / medium / high 压成同一个请求，界面上的进度条就是骗人的。
  assert.deepEqual(openAIThinking({ transport: 'switch', level: 'high' }), [
    { field: 'thinking', value: { type: 'enabled' } },
    { field: 'reasoning_effort', value: 'high' },
  ]);
  assert.deepEqual(openAIThinking({ transport: 'switch', level: 'low' }), [
    { field: 'thinking', value: { type: 'enabled' } },
    { field: 'reasoning_effort', value: 'low' },
  ]);
  assert.deepEqual(openAIThinking({ transport: 'switch', level: 'off' }), [{ field: 'thinking', value: { type: 'disabled' } }]);
  // 关闭档在 effort 方式下不发参数（端点没有 "off" 这个强度名）。
  assert.deepEqual(openAIThinking({ transport: 'effort', level: 'off' }), []);
  assert.deepEqual(openAIThinking({ transport: 'none', level: 'high' }), []);
  assert.deepEqual(openAIThinking({ transport: 'budget', level: 'high' }), []);
  assert.deepEqual(openAIThinking({ transport: 'effort', level: '' }), []);
});

test('发送方式由端点推断，不问用户', () => {
  // Claude 原生端点只能按预算发。
  assert.equal(deriveTransport('any-model', 'anthropic'), 'budget');
  // OpenAI 兼容：认得出的按名字走，认不出的回落到强度（这是该协议的通行写法，且 400 时会被剥掉重试）。
  assert.equal(deriveTransport('gpt-5.1', 'openai'), 'effort');
  assert.equal(deriveTransport('o3-mini', 'openai'), 'effort');
  assert.equal(deriveTransport('deepseek-v4.1-flash', 'openai'), 'switch');
  assert.equal(deriveTransport('gpt-4o', 'openai'), 'effort');
  assert.equal(deriveTransport('', 'openai'), 'effort');
});

test('会话标题永不花思考预算：开关型显式关闭，其余一律不附加强度', () => {
  assert.deepEqual(openAIThinking({ transport: 'switch', level: 'high', requestPurpose: 'session-title' }), [{ field: 'thinking', value: { type: 'disabled' } }]);
  assert.deepEqual(openAIThinking({ transport: 'effort', level: 'high', requestPurpose: 'session-title' }), []);
  assert.equal(anthropicThinking({ transport: 'budget', level: 'high', requestPurpose: 'session-title' }), null);
});

test('Claude 预算：只有 budget 方式发送，且关闭档不发', () => {
  assert.equal(anthropicThinking({ transport: 'budget', level: 'high' }), 16000);
  assert.equal(anthropicThinking({ transport: 'budget', level: 'minimal' }), 1024);
  assert.equal(anthropicThinking({ transport: 'budget', level: 'off' }), null);
  assert.equal(anthropicThinking({ transport: 'effort', level: 'high' }), null);
  assert.equal(anthropicThinking({ transport: 'none', level: 'high' }), null);
});

test('requestThinking 读当前渠道下选中模型的声明，不看别的模型', () => {
  const settings = {
    provider: 'openai', activeProviderId: 'p1', activeModel: 'm2', activeThinking: 'low',
    openai: { model: 'm2' },
    providers: [{ id: 'p1', type: 'openai', models: [
      { id: 'm1', thinking: { levels: ['high'], default: 'high', transport: 'effort' } },
      { id: 'm2', thinking: { levels: ['low', 'medium'], default: 'medium', transport: 'effort' } },
    ] }],
  };
  assert.deepEqual(requestThinking(settings, 'openai'), { transport: 'effort', level: 'low' });
  settings.activeThinking = 'high'; // 不在 m2 的声明里 → 回落 m2 的默认档，不借用 m1 的 high
  assert.deepEqual(requestThinking(settings, 'openai'), { transport: 'effort', level: 'medium' });
  // 没有渠道（旧配置）：读镜像字段
  const legacy = { provider: 'anthropic', anthropic: { model: 'claude-sonnet-4-5', thinking: { levels: ['off'], default: 'off', transport: 'budget' } } };
  assert.deepEqual(requestThinking(legacy, 'anthropic'), { transport: 'budget', level: 'off' });
});

test('未声明也不选档位时，请求里绝不带思考参数（这是保留旧行为的边界）', () => {
  // DeepSeek V4 默认就思考：不能因为「推断它支持」就替用户改线上请求体。
  const settings = { provider: 'openai', activeProviderId: 'p', activeModel: 'deepseek-v4.1-flash', openai: { model: 'deepseek-v4.1-flash' }, providers: [{ id: 'p', type: 'openai', models: ['deepseek-v4.1-flash'] }] };
  assert.deepEqual(requestThinking(settings, 'openai'), { transport: 'none', level: '' });
  assert.deepEqual(openAIThinking(requestThinking(settings, 'openai')), []);
  // Claude 同理：没声明就不发 thinking 块，温度也保持用户设置。
  const claude = { provider: 'anthropic', anthropic: { model: 'claude-sonnet-4-5' }, providers: [{ id: 'a', type: 'anthropic', models: ['claude-sonnet-4-5'] }], activeProviderId: 'a', activeModel: 'claude-sonnet-4-5' };
  assert.equal(anthropicThinking(requestThinking(claude, 'anthropic')), null);
});

test('未声明但用户显式选了档位：按模型名推断发送方式后发送', () => {
  const base = { provider: 'openai', activeProviderId: 'p', activeModel: 'gpt-5.1', openai: { model: 'gpt-5.1' }, providers: [{ id: 'p', type: 'openai', models: ['gpt-5.1'] }] };
  assert.deepEqual(requestThinking({ ...base, activeThinking: 'high' }, 'openai'), { transport: 'effort', level: 'high' });
  // 认不出传输方式的模型：即使用户选了档位也不发（发了只会 400）。
  const legacy = { ...base, activeModel: 'gpt-4o', openai: { model: 'gpt-4o' }, providers: [{ id: 'p', type: 'openai', models: ['gpt-4o'] }], activeThinking: 'high' };
  assert.deepEqual(requestThinking(legacy, 'openai'), { transport: 'none', level: '' });
});

// ---------- 真实请求装配：断言打到线上的 JSON ----------
async function serve(handler) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => (body += d));
    req.on('end', () => handler(req, body ? JSON.parse(body) : null, res));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { url: 'http://127.0.0.1:' + server.address().port, close: () => new Promise(r => server.close(r)) };
}
const sse = (res, events) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); for (const e of events) res.write('data: ' + JSON.stringify(e) + '\n'); res.end('data: [DONE]\n'); };

test('openai 端点：声明的档位真的发出去，未声明时一个参数都不带', async () => {
  const bodies = [];
  const srv = await serve((_req, body, res) => { bodies.push(body); sse(res, [{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }]); });
  try {
    const base = { provider: 'openai', openai: { baseUrl: srv.url + '/v1', apiKey: 'k', model: 'gpt-5.1' } };
    const high = { ...base, openai: { ...base.openai, thinking: { transport: 'effort', level: 'high' } } };
    await resolveProvider(high).complete([{ role: 'user', content: 'hi' }], [], {});
    assert.equal(bodies[0].reasoning_effort, 'high');

    const silent = { ...base, openai: { ...base.openai, thinking: { transport: 'none', level: 'high' } } };
    await resolveProvider(silent).complete([{ role: 'user', content: 'hi' }], [], {});
    assert.equal(bodies[1].reasoning_effort, undefined);

    const off = { ...base, openai: { ...base.openai, thinking: { transport: 'effort', level: 'off' } } };
    await resolveProvider(off).complete([{ role: 'user', content: 'hi' }], [], {});
    assert.equal(bodies[2].reasoning_effort, undefined);
  } finally { await srv.close(); }
});

test('openai 端点：开关型端点的不同档位必须发出不同请求（否则进度条是骗人的）', async () => {
  const bodies = [];
  const srv = await serve((_req, body, res) => { bodies.push(body); sse(res, [{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }]); });
  try {
    const base = { provider: 'openai', openai: { baseUrl: srv.url + '/v1', apiKey: 'k', model: 'deepseek-v4.1-flash' } };
    for (const level of ['off', 'low', 'high']) {
      await resolveProvider({ ...base, openai: { ...base.openai, thinking: { transport: 'switch', level } } }).complete([{ role: 'user', content: 'hi' }], [], {});
    }
    // 关：只发关闭。
    assert.deepEqual(bodies[0].thinking, { type: 'disabled' });
    assert.equal(bodies[0].reasoning_effort, undefined);
    // 低 / 高：都开，但强度不同 —— 这是老实现丢失的那一半。
    assert.deepEqual(bodies[1].thinking, { type: 'enabled' });
    assert.equal(bodies[1].reasoning_effort, 'low');
    assert.deepEqual(bodies[2].thinking, { type: 'enabled' });
    assert.equal(bodies[2].reasoning_effort, 'high');
    assert.notEqual(bodies[1].reasoning_effort, bodies[2].reasoning_effort, '关闭与高档之外，不同档位不能发成同一个请求');
  } finally { await srv.close(); }
});

test('openai 端点：不认思考参数时去掉参数重试，而不是整请求失败', async () => {
  const bodies = [];
  let n = 0;
  const srv = await serve((_req, body, res) => {
    bodies.push(body);
    if (n++ === 0) { res.writeHead(400); res.end('{"error":{"message":"Unsupported parameter: reasoning_effort"}}'); return; }
    sse(res, [{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }]);
  });
  try {
    const settings = { provider: 'openai', openai: { baseUrl: srv.url + '/v1', apiKey: 'k', model: 'gpt-4o', thinking: { transport: 'effort', level: 'high' } } };
    const r = await resolveProvider(settings).complete([{ role: 'user', content: 'hi' }], [], {});
    assert.equal(r.content, 'ok');
    assert.equal(bodies[0].reasoning_effort, 'high');
    assert.equal(bodies.at(-1).reasoning_effort, undefined, '重试请求必须去掉不被支持的思考参数');
  } finally { await srv.close(); }
});

test('openai 端点：开关型端点只认开关时，剥掉强度但保留开关（不能一起扔）', async () => {
  const bodies = [];
  let n = 0;
  const srv = await serve((_req, body, res) => {
    bodies.push(body);
    // 真实场景：DeepSeek 兼容网关认 thinking.type，但不认 reasoning_effort。
    if (n++ === 0) { res.writeHead(400); res.end('{"error":{"message":"Unsupported parameter: reasoning_effort"}}'); return; }
    sse(res, [{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }]);
  });
  try {
    const settings = { provider: 'openai', openai: { baseUrl: srv.url + '/v1', apiKey: 'k', model: 'deepseek-v4.1-flash', thinking: { transport: 'switch', level: 'high' } } };
    const r = await resolveProvider(settings).complete([{ role: 'user', content: 'hi' }], [], {});
    assert.equal(r.content, 'ok');
    assert.equal(bodies[0].reasoning_effort, 'high');
    // 重试时只丢掉强度，开关必须还在 —— 否则等于把「开启思考」也一起取消了。
    const last = bodies.at(-1);
    assert.equal(last.reasoning_effort, undefined);
    assert.deepEqual(last.thinking, { type: 'enabled' }, '剥掉强度后必须保留开启开关');
  } finally { await srv.close(); }
});

test('claude 端点：budget 方式把预算发出去，并同时满足 temperature=1 与 max_tokens 上限', async () => {
  const bodies = [];
  const srv = await serve((_req, body, res) => {
    bodies.push(body);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: ' + JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 1 } } }) + '\n');
    res.write('data: ' + JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } }) + '\n');
    res.end('data: ' + JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }) + '\n');
  });
  try {
    const settings = { provider: 'anthropic', temperature: 0.2, anthropic: { baseUrl: srv.url, apiKey: 'k', model: 'claude-sonnet-4-5', maxTokens: 4096, thinking: { transport: 'budget', level: 'high' } } };
    await resolveProvider(settings).complete([{ role: 'user', content: 'hi' }], [], {});
    const body = bodies[0];
    assert.deepEqual(body.thinking, { type: 'enabled', budget_tokens: 16000 });
    assert.equal(body.temperature, 1, '开思考时 Claude 只接受 temperature=1');
    assert.ok(body.max_tokens > body.thinking.budget_tokens, 'max_tokens 必须大于思考预算');
  } finally { await srv.close(); }

  // 关闭档：一个思考参数都不带，温度保持用户设置。
  const srv2 = await serve((_req, body, res) => {
    bodies.push(body);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: ' + JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } }) + '\n');
    res.end('data: ' + JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }) + '\n');
  });
  try {
    const settings = { provider: 'anthropic', temperature: 0.2, anthropic: { baseUrl: srv2.url, apiKey: 'k', model: 'claude-sonnet-4-5', maxTokens: 4096, thinking: { transport: 'budget', level: 'off' } } };
    await resolveProvider(settings).complete([{ role: 'user', content: 'hi' }], [], {});
    const body = bodies.at(-1);
    assert.equal(body.thinking, undefined);
    assert.equal(body.temperature, 0.2);
    assert.equal(body.max_tokens, 4096);
  } finally { await srv2.close(); }
});

// ---------- 持久化：三段式都要归一，否则 save() 写回再 load() 会丢字段 ----------
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wdh-think-'));
async function withAppData(dir, fn) {
  const prev = process.env.DECRYPTHUB_DATA_DIR;
  process.env.DECRYPTHUB_DATA_DIR = path.join(dir, 'WebDecryptHub');
  const mod = await import('../settings.mjs?t=' + Date.now() + Math.random());
  try { return await fn(mod); } finally { if (prev === undefined) delete process.env.DECRYPTHUB_DATA_DIR; else process.env.DECRYPTHUB_DATA_DIR = prev; }
}

test('settings：思考档位存得住，脏档位落盘前被清掉', async () => {
  const root = tmp(), dir = path.join(root, 'WebDecryptHub'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
    activeThinking: 'high',
    providers: [{ id: 'p', type: 'openai', models: [{ id: 'm', thinking: { levels: ['high', 'bogus'], default: 'high', transport: 'effort' } }] }],
  }));
  await withAppData(root, mod => {
    const s = mod.load();
    assert.equal(s.activeThinking, 'high');
    assert.deepEqual(s.providers[0].models[0].thinking, { levels: ['high'], default: 'high', transport: 'effort' });
    // 脏值：load 归一为空串（跟随模型声明），不是抛错或整段丢失
    s.activeThinking = 'ultra';
    mod.save(s);
    const written = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
    assert.equal(written.activeThinking, '');
    assert.deepEqual(written.providers[0].models[0].thinking.levels, ['high']);
  });
});

test('settings：未配置思考的模型不会被凭空写入声明', async () => {
  const root = tmp(), dir = path.join(root, 'WebDecryptHub'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
    openai: { model: 'deepseek-v4.1-flash' },
    providers: [{ id: 'p', type: 'openai', models: [{ id: 'deepseek-v4.1-flash' }, 'plain-string-model'] }],
  }));
  await withAppData(root, mod => {
    const s = mod.load();
    // 凭空加声明会改变线上请求体，所以这里必须保持「没有」。
    assert.equal(s.openai.thinking, undefined);
    assert.equal(s.providers[0].models[0].thinking, undefined);
    mod.save(s);
    const written = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
    assert.equal(written.openai.thinking, undefined);
    assert.equal(written.providers[0].models[0].thinking, undefined);
  });
});

test('settings：旧 settings.json 没有思考字段也能正常加载', async () => {
  const root = tmp(), dir = path.join(root, 'WebDecryptHub'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ provider: 'openai', openai: { model: 'gpt-4o' } }));
  await withAppData(root, mod => {
    const s = mod.load();
    assert.equal(s.activeThinking, '');
    assert.equal(s.openai.thinking, undefined);
  });
});
