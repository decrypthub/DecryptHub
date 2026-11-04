// 真实链路的压缩恢复验收：走真的 HTTP 适配器（providers/openai.mjs + http.mjs + model-retry.mjs），
// 只把端点换成本地假服务，不注入 chatFn。
//
// 为什么必须单独跑这个：单测是在 `agent.chat` 这一层注入的，绕过了 http.mjs 的错误构造、
// 绕过了 retryable() 的重试层、也绕过了 SSE 分帧。而「超限」恰好要在这三层里被正确识别——
// 任何一层把它当普通 4xx 吞掉，压缩恢复路径就永远看不到它，单测却仍然全绿。
//
// 夹具的核心是**估算与端点的 token 密度差**：
//   我们的 estimateTokens 按 3.6 字符/token 估（CJK 每字 1 token）；
//   假端点按 2 字符/token 算（更接近真实 CJK / JSON schema 的密度）。
// 于是会出现「我们以为才 84%、端点已经 100%」——触发线永远不响，这一轮本该直接失败。
// 恢复路径就是为了救这一格。用「无条件第一次 400」当夹具是假的：它测不出压缩后有没有变小。
//
// 用法：node scripts/verify-overflow-live.mjs
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Agent } from '../sidecar/agent.mjs';
import { resolveProvider } from '../sidecar/providers/index.mjs';

const WINDOW = 8192;
const SUMMARY_HEAD = '## 目标';

/** 端点视角的 token 数：每 2 个字符 1 token（比我们的 3.6 更接近真实）。 */
const serverTokens = messages => Math.ceil(messages.reduce((n, m) => n + String(m.content ?? '').length, 0) / 2);

/** 假 OpenAI 兼容端点：按自己的密度判超限，摘要请求永远成功。`summaryDelayMs` 用来验证取消。 */
function startFake({ summaryDelayMs = 0 } = {}) {
  const hits = { chat: 0, summary: 0 };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      let parsed = {};
      try { parsed = JSON.parse(body); } catch {}
      const messages = parsed.messages || [];
      const last = String(messages.at(-1)?.content || '');
      if (last.includes('上下文检查点生成任务')) {
        hits.summary++;
        // 摘要也走 SSE：验证压缩请求本身能在真实分帧下拿回文本
        const reply = () => {
          if (res.writableEnded || res.destroyed) return;
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `${SUMMARY_HEAD}\n- 已完成 sign 定位，证据在 .ctx 里` } }] })}\n\n`);
          res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 10 } })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
        };
        if (summaryDelayMs) { setTimeout(reply, summaryDelayMs).unref?.(); return; }
        return reply();
      }
      hits.chat++;
      const used = serverTokens(messages);
      if (used > WINDOW) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { type: 'invalid_request_error', message: `This model's maximum context length is ${WINDOW} tokens. However, your messages resulted in ${used} tokens. Please reduce the length of the messages.` } }));
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '分析完成' } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: used, completion_tokens: 4 } })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, hits, port: server.address().port })));
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wdh-live-overflow-'));
let failed = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ' — ' + extra : ''}`);
  if (!ok) failed++;
};

const { server, hits, port } = await startFake();
const settings = {
  provider: 'openai', maxSteps: 0, compactAt: 0.85, temperature: 0,
  openai: { apiKey: 'test-key', model: 'fake-model', baseUrl: `http://127.0.0.1:${port}/v1`, contextWindow: WINDOW },
};

const events = [];
const agent = new Agent({
  mcp: { tools: [], has: () => false, call: async () => ({ text: '' }) },
  browser: { requests: [], pages: [] },
  projectDir: tmp(),
  getSettings: () => settings,
  emit: (name, payload) => events.push([name, payload]),
  relaunch: async () => {},
  tools: [],
  // 关键：不注入 chatFn，让它走真的 resolveProvider（真适配器 + 真重试层 + 真 SSE 分帧）
  chatFn: (s, messages, tools, hooks) => resolveProvider({ ...s, openai: { ...s.openai, retryBaseMs: 5 } }).complete(messages, tools, hooks),
});

// 历史：刻意落在「估算低于触发线、端点已超窗」那条窄缝里——恢复路径只在这一缝里有意义。
//   触发线 = min(0.85×8192, 8192−819) = 6963（估算口径）
//   我们按 3.6 字符/token 估；端点按 2 字符/token 算（更接近真实 CJK/JSON 密度）
//   取 ≈18000 字符：估算 ≈5000 + 消息开销（< 6963，触发线不响），端点 ≈9000（> 8192，必超）
const BULK = 'z'.repeat(9000);
for (let i = 0; i < 2; i++) {
  agent.hist.append({ t: 'user', content: `阶段 ${i} ${BULK}` });
  agent.hist.append({ t: 'assistant', content: '收到' });
}

await agent.send('开始分析');

const done = events.find(([n]) => n === 'done');
const errs = events.filter(([n]) => n === 'error').map(([, p]) => String(p));
const ctxEvents = events.filter(([n]) => n === 'context').map(([, p]) => p?.event).filter(Boolean);

check('恢复路径的压缩排在触发它的那条记录之前', ctxEvents.indexOf('compressed') < ctxEvents.indexOf('overflow-recovered') || !ctxEvents.includes('compressed'),
  `context 事件顺序：${ctxEvents.join(' → ') || '（无）'}`);
check('端点超限被识别并重试了同一步', hits.chat >= 2, `chat 请求 ${hits.chat} 次（期望 ≥2）`);
check('重试前发起过摘要请求', hits.summary >= 1, `summary 请求 ${hits.summary} 次`);
check('本轮正常收尾（不是 error）', done?.[1]?.stop === 'completed', `stop=${done?.[1]?.stop}${errs.length ? ' errors=' + errs.join(' | ') : ''}`);
check('留下了 overflow-recovered 记录', ctxEvents.includes('overflow-recovered'));
check('检查点已提交', agent.hist.compressions >= 1, `compressions=${agent.hist.compressions}`);
check('历史仍是 append-only（旧事件还在）', agent.hist.events.some(e => e.t === 'user' && String(e.content).startsWith('阶段 0')));
check('摘要通过尺寸门（没有因为「没变小」被拒）', !ctxEvents.includes('skipped'));

// ---------------------------------------------------------------- 取消走真链路

// 取消必须真的打断在途的摘要请求。夹具刻意把摘要拖慢：如果 signal 没透传到
// http.mjs 的 abort 监听，这里会等到超时才返回，取消就成了装饰。
{
  const slow = await startFake({ summaryDelayMs: 5000 });
  const slowSettings = {
    provider: 'openai', maxSteps: 0, compactAt: 0.85, temperature: 0,
    openai: { apiKey: 'k', model: 'fake-model', baseUrl: `http://127.0.0.1:${slow.port}/v1`, contextWindow: WINDOW },
  };
  const cancelEvents = [];
  const cancelAgent = new Agent({
    mcp: { tools: [], has: () => false, call: async () => ({ text: '' }) },
    browser: { requests: [], pages: [] },
    projectDir: tmp(),
    getSettings: () => slowSettings,
    emit: (name, payload) => cancelEvents.push([name, payload]),
    relaunch: async () => {},
    tools: [],
    chatFn: (s, messages, tools, hooks) => resolveProvider({ ...s, openai: { ...s.openai, retryBaseMs: 5 } }).complete(messages, tools, hooks),
  });
  for (let i = 0; i < 2; i++) {
    cancelAgent.hist.append({ t: 'user', content: `阶段 ${i} ${'z'.repeat(9000)}` });
    cancelAgent.hist.append({ t: 'assistant', content: '收到' });
  }

  const controller = new AbortController();
  const started = Date.now();
  const running = cancelAgent.compress({ reason: 'manual', force: true, signal: controller.signal });
  // 等摘要请求真的发出去再取消（否则测的是「还没开始就取消」）
  await new Promise(r => setTimeout(r, 200));
  controller.abort();
  const result = await running;
  const elapsed = Date.now() - started;

  check('取消能在摘要返回前结束（不是等超时）', elapsed < 3000, `耗时 ${elapsed}ms（端点需 5000ms 才返回）`);
  check('取消被标记为 cancelled，而不是普通失败', result?.cancelled === true, JSON.stringify(result));
  check('取消后没有提交检查点', cancelAgent.hist.compressions === 0, `compressions=${cancelAgent.hist.compressions}`);
  check('取消后运行态复位（还能再压）', cancelAgent.compressing === false);
  check('取消事件能被界面看到', cancelEvents.some(([n, p]) => n === 'context' && p?.event === 'cancelled'));
  slow.server.close();
}

if (failed) {
  console.log('\n--- 诊断 ---');
  for (const [name, payload] of events) {
    if (name === 'log' || name === 'error') console.log(`${name}: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`);
  }
  const wire = agent.wire().filter(m => m.role !== 'system');
  console.log(`最终 wire: ${wire.length} 条消息，端点口径 ${serverTokens(wire)} token / 窗口 ${WINDOW}`);
  console.log(`overflowRetries=${agent.overflowRetries}`);
}

server.close();
console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
process.exitCode = failed ? 1 : 0;
