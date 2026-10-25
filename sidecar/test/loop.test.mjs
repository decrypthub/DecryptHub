// 循环级测试：用假 provider 驱动 Agent 的完整一步流程（不再需要真实 API / 浏览器）。
// 覆盖：工具批处理、参数校验回喂、步数上限收尾、中断补齐、自动压缩、落盘恢复、视图期裁剪。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Agent } from '../agent.mjs';
import { object, str, num } from '../contract.mjs';
import { AGENT_TOOLS } from '../agenttools.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wdh-loop-'));

/** 假工具：记录调用次数，便于断言「校验失败时没真正执行」 */
function probeTool() {
  const calls = [];
  return {
    calls,
    tool: {
      name: 'probe',
      description: '测试用工具',
      schema: object({ path: str('路径'), depth: num('深度') }, ['path']),
      run: async args => { calls.push(args); return { text: `ran ${args.path}` }; },
    },
  };
}

function fakeAgent({ tools = [], projectDir, settings = {}, maxSteps = 40, ask } = {}) {
  const events = [];
  const emitted = [];
  const agent = new Agent({
    mcp: { tools: [], has: () => false, call: async () => ({ text: 'mcp' }) },
    browser: { requests: [], pages: [] },
    projectDir,
    getSettings: () => ({ maxSteps, compactAt: 0.85, openai: { apiKey: 'k', model: 'm', contextWindow: 1000000 }, ...settings }),
    emit: (name, payload) => { emitted.push([name, payload]); events.push(name); },
    relaunch: async () => {},
    tools: tools.map(t => ({ risk: 'read', ...t })),
    ask,
    // 默认不联网：忘了注入假 provider 的用例会直接报错，而不是去打真实 API
    chatFn: async () => { throw new Error('测试未注入假 provider'); },
  });
  return { agent, events, emitted };
}

/** 按脚本依次返回结果的假 provider；脚本弹出后重复最后一项 */
function scripted(replies) {
  let i = 0;
  const calls = [];
  const fn = async (settings, messages, tools) => {
    calls.push({ messages, tools });
    const r = typeof replies === 'function' ? replies(messages, tools) : replies[Math.min(i++, replies.length - 1)];
    return typeof r === 'function' ? r(messages, tools) : r;
  };
  fn.calls = calls;
  return fn;
}

const answer = (content) => ({ content, toolCalls: [], usage: null, finishReason: 'stop' });
const callTool = (name, args, id = 'c1') => ({ content: '', toolCalls: [{ id, name, args }], usage: null, finishReason: 'tool_calls' });

test('send: 一次工具调用 + 收尾回答，事件顺序正确', async () => {
  const dir = tmp();
  const p = probeTool();
  const { agent, emitted } = fakeAgent({ tools: [p.tool], projectDir: dir });
  agent.chat = scripted([callTool('probe', { path: 'a.js', depth: 2 }), answer('完成')]);
  await agent.send('开始');
  assert.deepEqual(agent.hist.events.map(e => e.t), ['user', 'assistant', 'tool', 'assistant', 'turn-end']);
  assert.equal(agent.hist.events[1].phase, 'commentary');
  assert.equal(agent.hist.events[3].phase, 'final_answer');
  assert.equal(agent.hist.events[4].turnId, agent.hist.events[0].turnId);
  assert.deepEqual(p.calls, [{ path: 'a.js', depth: 2 }]);
  assert.equal(agent.hist.events[2].content, 'ran a.js');
  const done = emitted.find(([n]) => n === 'done');
  assert.equal(done[1].stop, 'completed');
  assert.equal(done[1].usage.calls, 2);
});

test('参数校验：类型/必填不对时回喂模型，且工具不被执行', async () => {
  const dir = tmp();
  const p = probeTool();
  const { agent } = fakeAgent({ tools: [p.tool], projectDir: dir });
  // depth 用字符串会被强转；path 缺失则应报错
  agent.chat = scripted([callTool('probe', { depth: 2 }), answer('好')]);
  await agent.send('x');
  assert.equal(p.calls.length, 0);
  assert.match(agent.hist.events[2].content, /\[参数错误\] 缺少必填参数 path/);
  assert.equal(agent.hist.events[2].isError, true);

  // 数值字符串被强转成数字
  const b = fakeAgent({ tools: [p.tool], projectDir: tmp() });
  b.agent.chat = scripted([callTool('probe', { path: 'b.js', depth: '3' }), answer('好')]);
  await b.agent.send('x');
  assert.deepEqual(p.calls.at(-1), { path: 'b.js', depth: 3 });
});

test('步数上限：收尾步骤仍返回工具调用时补占位结果，不留悬空 tool_calls', async () => {
  const dir = tmp();
  const p = probeTool();
  const { agent, emitted } = fakeAgent({ tools: [p.tool], projectDir: dir, maxSteps: 2 });
  agent.chat = scripted([callTool('probe', { path: 'a' }, 'k1'), callTool('probe', { path: 'b' }, 'k2')]);
  await agent.send('x', { maxSteps: 2 });
  const done = emitted.find(([n]) => n === 'done');
  assert.equal(done[1].stop, 'max-steps');
  // 每个 tool_call 都必须有对应的 tool 事件
  for (const a of agent.hist.events.filter(e => e.t === 'assistant')) {
    for (const c of a.calls || []) {
      assert.ok(agent.hist.events.some(e => e.t === 'tool' && e.id === c.id), `缺少 ${c.id} 的结果`);
    }
  }
  assert.ok(agent.hist.events.some(e => e.t === 'tool' && e.content === '[已收尾，未执行]'));
});

test('unlimited runs continue beyond forty successful tool rounds', async () => {
  const p = probeTool(), { agent, emitted } = fakeAgent({ tools: [p.tool], projectDir: tmp(), maxSteps: 0 });
  let count = 0;
  agent.chat = async () => ++count <= 45 ? callTool('probe', { path: 'same-successful-observation' }, 'read-' + count) : answer('完成');
  await agent.send('完成复杂任务');
  assert.equal(p.calls.length, 45); assert.equal(emitted.find(([name]) => name === 'done')[1].stop, 'completed');
});
test('identical failures trigger a rethink then a diagnosable pause, without executing more failures', async () => {
  const p = probeTool(); p.tool.run = async () => ({ text: 'fixture: permission denied', isError: true });
  const { agent, emitted } = fakeAgent({ tools: [p.tool], projectDir: tmp(), maxSteps: 0 }); let count = 0;
  agent.chat = async (_s, _m, tools) => tools.length ? callTool('probe', { path: 'same' }, 'fail-' + ++count) : answer('需要解决访问问题后继续。');
  await agent.send('任务');
  assert.equal(count, 6); assert.equal(emitted.find(([name]) => name === 'done')[1].stop, 'stalled');
  assert.equal(agent.hist.events.filter(e => e.t === 'user' && e.content.includes('改变方法')).length, 2);
});
test('中断：未执行的工具补「已中断」，transcript 保持合法', async () => {
  const dir = tmp();
  const p = probeTool();
  const { agent } = fakeAgent({ tools: [p.tool], projectDir: dir });
  agent.chat = async () => ({ content: '', toolCalls: [{ id: 'a1', name: 'probe', args: { path: '1' } }, { id: 'a2', name: 'probe', args: { path: '2' } }], usage: null });
  // 第一个工具开始前中断
  const origEmit = agent.emit;
  agent.emit = (name, payload) => { origEmit(name, payload); if (name === 'tool-start') agent.interrupt(); };
  await agent.send('x');
  assert.equal(p.calls.length, 1);
  assert.ok(agent.hist.events.some(e => e.t === 'tool' && e.id === 'a1'));
  assert.equal(agent.hist.events.find(e => e.t === 'tool' && e.id === 'a2').content, '[已中断，未执行]');
});

test('successful compactions re-arm throughout long runs; repeated failures stay bounded', async () => {
  const { agent } = fakeAgent({ projectDir: tmp(), maxSteps: 0 });
  let used = 9000, calls = 0;
  agent.stats = () => ({ used, trigger: 8500, limit: 10000 });
  agent.compress = async () => { calls++; agent.lastCompressAfter = used = 1000; return { ok: true }; };
  let failures = 0;
  for (let i = 0; i < 4; i++) { used = 9000; failures = await agent.maybeAutoCompress(failures); }
  assert.equal(calls, 4); assert.equal(failures, 0);
  agent.compress = async () => { calls++; throw new Error('fixture unavailable'); }; agent.lastCompressAfter = null;
  for (let i = 0; i < 4; i++) { used = 9000 + i * 2000; failures = await agent.maybeAutoCompress(failures); }
  assert.equal(calls, 6); assert.equal(failures, 2);
});
test('自动压缩：阈值触发 → 追加检查点事件，历史不被删改', async () => {
  const dir = tmp();
  const settings = { maxSteps: 40, compactAt: 0.85, openai: { apiKey: 'k', model: 'm', contextWindow: 8000 } };
  const { agent, emitted } = fakeAgent({ projectDir: dir, settings });
  let summaryCalls = 0;
  agent.chat = async (s, messages) => {
    if (messages[0]?.content?.includes('上下文检查点生成器')) { summaryCalls++; return { content: '## 目标\n- 分析 sign', toolCalls: [], usage: null }; }
    return answer('收到');
  };
  agent.getSettings = () => settings;
  const big = i => `第${i}轮 ` + 'z'.repeat(9000); // 每轮约 2.5k tokens，撑满 2k 的保留预算
  await agent.send(big(1));
  await agent.send(big(2));
  const before = agent.hist.events.length;
  await agent.send(big(3));
  assert.ok(summaryCalls >= 1, '应调用过一次摘要');
  assert.ok(agent.hist.compressions >= 1);
  assert.ok(agent.hist.events.length > before);
  // 压缩前的 user 事件仍在日志里（append-only）
  assert.ok(agent.hist.events.some(e => e.t === 'user' && String(e.content).startsWith('第1轮')));
  // 视图从检查点之后继续
  const wire = agent.wire(true);
  assert.match(wire[1].content, /上下文检查点/);
  assert.ok(emitted.some(([n, p]) => n === 'context' && p?.event === 'compressed'));
});

test('落盘与恢复：事件完整往返，视图一致', async () => {
  const dir = tmp();
  const a = fakeAgent({ projectDir: dir });
  a.agent.chat = scripted([answer('你好')]);
  await a.agent.send('hi');
  const file = path.join(dir, '.agent-history.json');
  assert.ok(fs.existsSync(file));
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.v, 2);

  const b = fakeAgent({ projectDir: dir });
  b.agent.restore();
  assert.deepEqual(b.agent.hist.events, a.agent.hist.events);
  assert.equal(b.agent.wire()[1].content, a.agent.wire()[1].content);
});

test('大工具输出：落盘成 ctx_ref，事件里只留摘要；兜底裁剪只影响视图', async () => {
  const dir = tmp();
  const big = { name: 'big', description: 'd', schema: object({}), run: async () => ({ text: 'Z'.repeat(9000) }) };
  const { agent } = fakeAgent({ tools: [big], projectDir: dir });
  let n = 0;
  agent.chat = async () => (n++ < 4 ? callTool('big', {}, 'c' + n) : answer('完'));
  await agent.send('x');
  const toolEvents = agent.hist.events.filter(e => e.t === 'tool');
  assert.equal(toolEvents.length, 4);
  assert.ok(toolEvents.every(e => e.content.includes('context_ref_read') && e.content.length < 3000), '入口处已截断并给出引用');
  assert.ok(fs.readdirSync(path.join(dir, '.ctx')).length >= 1, '完整输出落盘到 .ctx');

  // 兜底：更激进的裁剪参数只改变视图，事件仍是原样
  const before = JSON.stringify(agent.hist.events);
  agent._emergency = { keep: 1, minChars: 600, dir: path.join(dir, '.ctx') };
  const wireTools = agent.wire().filter(m => m.role === 'tool');
  assert.equal(wireTools[0].content.length < 600, true);
  assert.equal(JSON.stringify(agent.hist.events), before);
});

test('压缩后 wire 仍满足 tool_call/tool 成对（两个 provider 都不会 400）', async () => {
  const dir = tmp();
  const p = probeTool();
  const { agent } = fakeAgent({ tools: [p.tool], projectDir: dir });
  let n = 0;
  agent.chat = scripted([() => callTool('probe', { path: 'a' }, 'x' + (++n)), answer('ok')]);
  await agent.send('x');
  await agent.send('y');
  const wire = agent.wire();
  const callIds = new Set();
  for (const m of wire) for (const c of m.tool_calls || []) callIds.add(c.id);
  for (const m of wire) if (m.role === 'tool') assert.ok(callIds.has(m.tool_call_id), `孤儿 tool 结果 ${m.tool_call_id}`);
});

test('newChat: 归档到 .chats 并清空；reset 保留压缩计数归零', async () => {
  const dir = tmp();
  const { agent } = fakeAgent({ projectDir: dir });
  agent.chat = scripted([answer('a')]);
  await agent.send('x');
  agent.newChat();
  assert.equal(agent.hist.events.length, 0);
  const chats = fs.readdirSync(path.join(dir, '.chats'));
  assert.equal(chats.length, 1);
  const archived = JSON.parse(fs.readFileSync(path.join(dir, '.chats', chats[0]), 'utf8'));
  assert.ok(archived.events.length >= 2);
});

// ---------------------------------------------------------------- 交给模型决定的两件事

test('ask_user: 问题与选项透传到界面，回答回喂模型', async () => {
  const seen = [];
  const { agent } = fakeAgent({
    tools: AGENT_TOOLS,
    projectDir: tmp(),
    ask: async req => { seen.push(req); return '走接口 B'; },
  });
  agent.chat = scripted([callTool('ask_user', { question: '用哪个接口？', options: ['A', 'B'], kind: 'question' }), answer('好')]);
  await agent.send('x');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].question, '用哪个接口？');
  assert.deepEqual(seen[0].options, ['A', 'B']);
  assert.equal(seen[0].kind, 'question');
  const toolEvent = agent.hist.events.find(e => e.t === 'tool' && e.name === 'ask_user');
  assert.match(toolEvent.content, /用户回答：走接口 B/);
});

test('ask_user: 用户跳过时不算错误，提示按判断继续', async () => {
  const { agent } = fakeAgent({ tools: AGENT_TOOLS, projectDir: tmp(), ask: async () => '' });
  agent.chat = scripted([callTool('ask_user', { question: '要继续吗' }), answer('好')]);
  await agent.send('x');
  const toolEvent = agent.hist.events.find(e => e.t === 'tool' && e.name === 'ask_user');
  assert.match(toolEvent.content, /没有回答/);
  assert.equal(toolEvent.isError, undefined);
});

test('ask_user: 没有提问通道时（例如直连 tool-run）给一句说明而不是报错', async () => {
  const { agent } = fakeAgent({ tools: AGENT_TOOLS, projectDir: tmp() });
  const r = await agent.runTool('ask_user', { question: 'x' });
  assert.equal(r.isError, false);
  assert.match(r.text, /不支持提问/);
});

test('compact_context: 历史太少 → 提示没压缩（不是错误）', async () => {
  const { agent } = fakeAgent({ tools: AGENT_TOOLS, projectDir: tmp() });
  agent.hist.append({ t: 'user', content: '只有一条' });
  const r = await agent.runTool('compact_context', {});
  assert.equal(r.isError, false);
  assert.match(r.text, /没有压缩/);
  assert.equal(agent.hist.compressions, 0);
});

test('compact_context: 够长的历史 → 追加检查点，返回前后用量', async () => {
  const { agent } = fakeAgent({ tools: AGENT_TOOLS, projectDir: tmp() });
  let summaryAsked = 0;
  agent.chat = async (s, messages) => {
    if (messages[0]?.content?.includes('上下文检查点生成器')) { summaryAsked++; return { content: '## 目标\n- 保留 sign 结论', toolCalls: [], usage: null }; }
    return answer('ok');
  };
  agent.hist.append({ t: 'user', content: '评估 A ' + 'a '.repeat(4000) });
  agent.hist.append({ t: 'assistant', content: '收到' });
  agent.hist.append({ t: 'user', content: '评估 B ' + 'b '.repeat(4000) });
  const r = await agent.runTool('compact_context', { instructions: '保留 sign 结论' });
  assert.equal(r.isError, undefined);
  assert.match(r.text, /已压缩/);
  assert.equal(summaryAsked, 1);
  assert.equal(agent.hist.compressions, 1);
  assert.match(agent.hist.lastSummary.event.content, /保留 sign 结论/);
  // 检查点挡住了旧事件，但历史本身没被删
  assert.ok(agent.hist.events.length >= 4);
});
