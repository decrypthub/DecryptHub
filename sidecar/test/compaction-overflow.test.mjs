// 压缩链路上「会静默失效」的三件事，各一把锁：
// ① 上游说「上下文放不下」时，必须压缩后重试，而不是整轮直接失败；
// ② 摘要必须真的更小，否则不提交（提交等于把成本问题锁进历史）；
// ③ 手动压缩必须真的能取消（不是把界面上的提示条收起来）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Agent } from '../agent.mjs';
import { isContextOverflowError, CONTEXT_OVERFLOW, retryable } from '../providers/http.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wdh-overflow-'));

function agentAt(projectDir, settings = {}) {
  const emitted = [];
  const agent = new Agent({
    mcp: { tools: [], has: () => false, call: async () => ({ text: 'mcp' }) },
    browser: { requests: [], pages: [] },
    projectDir,
    getSettings: () => ({ maxSteps: 0, compactAt: 0.85, openai: { apiKey: 'k', model: 'm', contextWindow: 1000000 }, ...settings }),
    emit: (name, payload) => emitted.push([name, payload]),
    relaunch: async () => {},
    tools: [],
    chatFn: async () => { throw new Error('测试未注入假 provider'); },
  });
  return { agent, emitted };
}

const overflowError = (message = 'maximum context length is 128000 tokens') => Object.assign(new Error(message), { status: 400, code: CONTEXT_OVERFLOW });

// ---------------------------------------------------------------- ① 溢出识别

test('溢出识别：只认措辞，不把任何 400 都当成超限', () => {
  // 各家文案都要认出来
  for (const text of [
    'maximum context length is 128000 tokens. However, your messages resulted in 130001 tokens',
    'This model\'s maximum context length is 1048576 tokens',
    'prompt is too long: 210000 tokens > 200000 maximum',
    'input is too long for requested model',
    "This model's maximum context length is 8192 tokens",
    'Please reduce the length of the messages',
    '上下文长度超过限制',
    '超出最大上下文窗口',
    'context_length_exceeded',
    'exceeds the context window',
  ]) {
    assert.equal(isContextOverflowError(Object.assign(new Error(text), { status: 400 })), true, text);
  }
  // 真正的参数错误不能被误判成超限，否则会白压一次历史
  assert.equal(isContextOverflowError(Object.assign(new Error('invalid value for temperature'), { status: 400 })), false);
  assert.equal(isContextOverflowError(Object.assign(new Error('reasoning_effort is not supported'), { status: 400 })), false);
  // 配额/鉴权类即使文案撞词也不是超限（压缩解决不了欠费和密钥）
  assert.equal(isContextOverflowError(Object.assign(new Error('context length quota exceeded'), { status: 429 })), false);
  assert.equal(isContextOverflowError(Object.assign(new Error('context length'), { status: 403 })), false);
  // 流内错误（没有状态码）也要认
  assert.equal(isContextOverflowError(new Error('exceeds the context window of this model')), true);
});

test('溢出错误不进重试层：必须交给压缩恢复路径，否则永远看不到它', () => {
  const e = overflowError();
  assert.equal(retryable(e), false, '重试同样的历史只会再失败一次');
  // 普通的 5xx 仍然重试，不要误伤
  assert.equal(retryable(Object.assign(new Error('boom'), { status: 503 })), true);
});

// ---------------------------------------------------------------- ① 恢复路径

// 用一个「小窗口」夹具：历史必须真的超过保留预算，plan() 才会给出可压缩区间。
// 1M 窗口下几十 KB 的历史连触发线都摸不到，测出来的是「压不动」而不是「恢复路径」。
const SMALL = { openai: { apiKey: 'k', model: 'm', contextWindow: 8000 } };

/** send() 把错误收敛成事件（不 reject），所以断言要看 done 与 error 事件。 */
const stoppedWith = (emitted, stop) => emitted.some(([n, p]) => n === 'done' && p?.stop === stop);
const errorText = emitted => emitted.filter(([n]) => n === 'error').map(([, p]) => String(p)).join('\n');

test('上游超限 → 压缩一次 → 同一步重试成功', async () => {
  const { agent, emitted } = agentAt(tmp(), SMALL);
  // 先塞一段长历史，让 plan() 有东西可压
  for (let i = 0; i < 4; i++) {
    agent.hist.append({ t: 'user', content: '评估 ' + i + ' ' + 'z'.repeat(3000) });
    agent.hist.append({ t: 'assistant', content: '收到' });
  }
  let summaryCalls = 0, modelCalls = 0;
  agent.chat = async (_s, messages) => {
    if (/上下文检查点生成任务/.test(String(messages.at(-1)?.content || ''))) {
      summaryCalls++;
      return { content: '## 目标\n- 继续分析', toolCalls: [], usage: null };
    }
    modelCalls++;
    // 第一次真实请求：上游报放不下。压缩后的第二次：正常收尾。
    if (modelCalls === 1) throw overflowError();
    return { content: '完成', toolCalls: [], usage: null, finishReason: 'stop' };
  };

  await agent.send('开始');
  assert.equal(modelCalls, 2, '必须重试同一步，而不是整轮失败');
  assert.equal(summaryCalls, 1, '重试前必须先压缩一次');
  assert.equal(agent.overflowRetries, 1);
  assert.ok(stoppedWith(emitted, 'completed'), '重试成功后本轮应正常收尾：' + errorText(emitted));
  assert.ok(emitted.some(([n, p]) => n === 'context' && p?.event === 'overflow-recovered'), '恢复过程要留下可观察的记录');
  // 历史是 append-only：压缩只追加检查点
  assert.ok(agent.hist.compressions >= 1);
  assert.ok(agent.hist.events.some(e => e.t === 'user' && String(e.content).startsWith('评估 0')));
});

test('压缩没能让历史变短时，不在同一个历史再撞一次', async () => {
  const { agent, emitted } = agentAt(tmp(), SMALL);
  for (let i = 0; i < 4; i++) {
    agent.hist.append({ t: 'user', content: 'x' + i + ' ' + 'z'.repeat(3000) });
    agent.hist.append({ t: 'assistant', content: 'ok' });
  }
  let modelCalls = 0;
  agent.chat = async () => { modelCalls++; throw overflowError(); };
  // 摘要没有产生更短的历史 → 视为「没有缩减」，不该拿同一份历史重试
  agent.compress = async () => ({ ok: false, stage: 'summary', error: '摘要没有变小', before: 100, after: 100 });

  await agent.send('开始');
  assert.equal(modelCalls, 1, '拿同一份历史重试只会再失败一次，不能循环');
  assert.ok(stoppedWith(emitted, 'error'));
  assert.match(errorText(emitted), /context|上下文|maximum/i);
});

test('只重试一次：第二次仍然超限就老实失败', async () => {
  const { agent, emitted } = agentAt(tmp(), SMALL);
  for (let i = 0; i < 4; i++) {
    agent.hist.append({ t: 'user', content: 'x' + i + ' ' + 'z'.repeat(3000) });
    agent.hist.append({ t: 'assistant', content: 'ok' });
  }
  let modelCalls = 0;
  agent.chat = async (_s, messages) => {
    if (/上下文检查点生成任务/.test(String(messages.at(-1)?.content || ''))) return { content: '## 目标\n- x', toolCalls: [], usage: null };
    modelCalls++;
    throw overflowError();
  };
  await agent.send('开始');
  assert.equal(modelCalls, 2, '一次原始调用 + 一次重试，不能无限循环');
  assert.ok(stoppedWith(emitted, 'error'));
});

test('别的错误照常冒泡，不走压缩恢复', async () => {
  const { agent, emitted } = agentAt(tmp(), SMALL);
  for (let i = 0; i < 4; i++) {
    agent.hist.append({ t: 'user', content: 'x' + i + ' ' + 'z'.repeat(3000) });
    agent.hist.append({ t: 'assistant', content: 'ok' });
  }
  let compressed = 0;
  agent.compress = async () => { compressed++; return { ok: true }; };
  agent.chat = async () => { throw Object.assign(new Error('invalid api key'), { status: 401 }); };
  await agent.send('x');
  assert.equal(compressed, 0, '鉴权错误和上下文无关，不该去压历史');
  assert.ok(stoppedWith(emitted, 'error'));
  assert.match(errorText(emitted), /invalid api key/);
});

// ---------------------------------------------------------------- ② 尺寸校验

test('摘要比被替换区间还长时不提交，历史保持原样', async () => {
  const { agent, emitted } = agentAt(tmp());
  for (let i = 0; i < 4; i++) {
    agent.hist.append({ t: 'user', content: '短' + i });
    agent.hist.append({ t: 'assistant', content: 'ok' });
  }
  const before = JSON.stringify(agent.hist.events);
  // 返回一段远长于原文的「摘要」
  agent.chat = async () => ({ content: '冗长摘要\n' + 'z'.repeat(50000), toolCalls: [], usage: null });
  const r = await agent.compress({ reason: 'manual', force: true });

  assert.equal(r.ok, false);
  assert.equal(r.stage, 'summary');
  assert.match(r.error, /没有变小/);
  assert.equal(agent.hist.compressions, 0, '不能提交一个更大的摘要');
  assert.equal(JSON.stringify(agent.hist.events), before, '事件日志必须原样保留');
  assert.ok(emitted.some(([n, p]) => n === 'context' && p?.event === 'skipped'), '跳过要能被界面看见');
});

test('摘要在尺寸上确实更小时正常提交', async () => {
  const { agent } = agentAt(tmp());
  for (let i = 0; i < 4; i++) {
    agent.hist.append({ t: 'user', content: '很长的历史 ' + i + ' ' + 'z'.repeat(4000) });
    agent.hist.append({ t: 'assistant', content: 'ok' });
  }
  agent.chat = async () => ({ content: '## 目标\n- 一句话结论', toolCalls: [], usage: null });
  const r = await agent.compress({ reason: 'manual', force: true });
  assert.equal(r.ok, true);
  assert.equal(agent.hist.compressions, 1);
  assert.ok(r.after < r.before, '提交后用量必须下降');
});

// ---------------------------------------------------------------- ③ 可取消

test('手动压缩可取消：signal 真的打断摘要请求，且不提交检查点', async () => {
  const { agent, emitted } = agentAt(tmp());
  for (let i = 0; i < 4; i++) {
    agent.hist.append({ t: 'user', content: 'x' + i + ' ' + 'z'.repeat(4000) });
    agent.hist.append({ t: 'assistant', content: 'ok' });
  }
  const controller = new AbortController();
  agent.chat = async (_s, _m, _t, hooks) => {
    // 摘要请求要真的尊重 signal：这是「取消按钮不是装饰」的唯一证据
    assert.ok(hooks?.signal, '摘要调用必须拿到 signal');
    controller.abort();
    hooks.signal.throwIfAborted();
    return { content: '不会到这里', toolCalls: [], usage: null };
  };
  const r = await agent.compress({ reason: 'manual', force: true, signal: controller.signal });

  assert.equal(r.ok, false);
  assert.equal(r.cancelled, true, '取消要能和「压缩失败」区分开');
  assert.equal(agent.hist.compressions, 0);
  assert.equal(agent.compressing, false, '取消后必须复位运行态，否则再也不能压');
  assert.ok(emitted.some(([n, p]) => n === 'context' && p?.event === 'cancelled'));
});

test('压缩进行中会广播 compressing=true，结束后复位', async () => {
  const { agent, emitted } = agentAt(tmp());
  for (let i = 0; i < 3; i++) {
    agent.hist.append({ t: 'user', content: 'x' + i + ' ' + 'z'.repeat(4000) });
    agent.hist.append({ t: 'assistant', content: 'ok' });
  }
  agent.chat = async () => ({ content: '## 目标\n- x', toolCalls: [], usage: null });
  await agent.compress({ reason: 'manual', force: true });
  const flags = emitted.filter(([n]) => n === 'context').map(([, p]) => p.compressing);
  assert.ok(flags.includes(true), '开始压缩要广播 compressing=true（界面靠它显示运行条）');
  assert.equal(flags.at(-1), false, '结束时必须复位');
});

test('同时两次压缩：第二次直接拒绝，不并发写检查点', async () => {
  const { agent } = agentAt(tmp());
  for (let i = 0; i < 3; i++) {
    agent.hist.append({ t: 'user', content: 'x' + i + ' ' + 'z'.repeat(4000) });
    agent.hist.append({ t: 'assistant', content: 'ok' });
  }
  let release; const gate = new Promise(r => { release = r; });
  agent.chat = async () => { await gate; return { content: '## 目标\n- x', toolCalls: [], usage: null }; };
  const first = agent.compress({ reason: 'manual', force: true });
  const second = await agent.compress({ reason: 'manual', force: true });
  assert.equal(second.ok, false);
  assert.match(second.error, /正在压缩/);
  release();
  await first;
  assert.equal(agent.hist.compressions, 1, '只能提交一次检查点');
});
