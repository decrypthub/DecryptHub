// ask_user 的四种结局必须可区分。
//
// 起因：用户点「跳过」后，模型却说「按判断继续」并去跑需要审批的 shell 探测。
// 根因是跳过/超时/中断被压成同一个空字符串，模型无法判断这是「明确不要」还是「没看到」。
// 参考 DSH skippedAnswerGuidance：跳过要明确「不要复用、不要重问、不是授权」。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AGENT_TOOLS, ASK_OUTCOME } from '../agenttools.mjs';
import { TestSessionManager } from './project-fixture.mjs';

const askTool = AGENT_TOOLS.find(t => t.name === 'ask_user');

const run = async (ctx, args = { question: '要不要继续？' }) => askTool.run(args, ctx);

test('用户回答时原样回传，并说明可作为输入', async () => {
  const r = await run({ ask: async () => ({ status: 'answered', answer: '用 A 方案' }) });
  assert.match(r.text, /用户回答：用 A 方案/);
  assert.match(r.text, /当作本次任务的有效输入/);
  assert.equal(r.isError, false);
});

test('跳过 ≠ 授权：必须同时说明不要复用、不要重问、不是授权', async () => {
  const r = await run({ ask: async () => ({ status: 'skipped', answer: '' }) });
  assert.match(r.text, /提问结果：skipped/);
  assert.match(r.text, /不要复用这条信息/, '跳过意味着这条信息不能拿来用');
  assert.match(r.text, /不要重复问同一个问题/, '不要反复追问');
  assert.match(r.text, /不要把它当成授权/, '关键：跳过不是授权');
  assert.match(r.text, /不要自行选择替代方案去做需要审批的操作/, '不得借跳过自行执行需审批操作');
  assert.equal(r.isError, false, '跳过是正常结局，不是错误');
});

test('超时与跳过语义不同：允许继续独立工作，用户仍可补答', async () => {
  const r = await run({ ask: async () => ({ status: 'timed-out' }) });
  assert.match(r.text, /提问结果：timed-out/);
  assert.match(r.text, /不是跳过/);
  assert.match(r.text, /互不影响的工作/);
  assert.match(r.text, /仍可回答/);
  assert.match(r.text, /不要把超时当成授权/);
});

test('取消时不鼓励沿这一支继续', async () => {
  const r = await run({ ask: async () => ({ status: 'cancelled' }) });
  assert.match(r.text, /提问结果：cancelled/);
  assert.match(r.text, /不要沿这一支继续/);
});

test('未知状态按跳过处理，绝不当作已回答', async () => {
  const r = await run({ ask: async () => ({ status: 'weird', answer: '' }) });
  assert.match(r.text, /提问结果：skipped/);
  assert.match(r.text, /不要把它当成授权/);
});

test('旧调用方返回纯字符串时仍能工作', async () => {
  const answered = await run({ ask: async () => '好的' });
  assert.match(answered.text, /用户回答：好的/);
  const empty = await run({ ask: async () => '' });
  assert.match(empty.text, /提问结果：skipped/, '空字符串按跳过处理，而不是当成已回答');
});

test('问题原文会带回给模型，避免忘记问的是什么', async () => {
  let asked = null;
  const r = await run({ ask: async req => { asked = req; return { status: 'skipped', question: req.question }; } }, { question: '目标站点是哪个？' });
  assert.equal(asked.question, '目标站点是哪个？', '请求要带上原问题');
  assert.match(r.text, /目标站点是哪个？/);
});

test('工具描述里写明了跳过的含义', () => {
  assert.match(askTool.description, /跳过/);
  assert.match(askTool.description, /不要重复问/);
  assert.match(askTool.description, /不要.*授权/);
});test('四种结局都有对应说明，不会遗漏', () => {
  for (const status of ['answered', 'skipped', 'timed-out', 'cancelled']) {
    assert.ok(ASK_OUTCOME[status], '缺少结局说明：' + status);
  }
});

// ---- 会话层：三种"没有答案"的原因必须分开 ----

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wdh-ask-'));
const manager = dir => new TestSessionManager({
  userDataDir: dir,
  getSettings: () => ({ openai: { apiKey: 'fixture', model: 'test', contextWindow: 1000000 } }),
  broadcast() {},
  chromeMod: {},
});

function bareSession(t) {
  const dir = tmp();
  const mgr = manager(dir);
  t?.after(() => mgr.closeAll());
  return mgr.get('main');
}

test('点击跳过时返回 skipped，而不是空字符串', async t => {
  const s = bareSession(t);
  const pending = s.ask({ question: '继续吗' });
  const id = [...s.askPending.keys()][0];
  s.answerAsk(id, '', { skipped: true });
  const outcome = await pending;
  assert.equal(outcome.status, 'skipped');
  assert.equal(outcome.question, '继续吗');
});

test('正常回答返回 answered 与内容', async t => {
  const s = bareSession(t);
  const pending = s.ask({ question: '选哪个' });
  const id = [...s.askPending.keys()][0];
  s.answerAsk(id, '选 B');
  const outcome = await pending;
  assert.equal(outcome.status, 'answered');
  assert.equal(outcome.answer, '选 B');
});

test('没有跳过标记但内容为空，也按跳过判定', async t => {
  const s = bareSession(t);
  const pending = s.ask({ question: '继续吗' });
  const id = [...s.askPending.keys()][0];
  s.answerAsk(id, '   ');
  assert.equal((await pending).status, 'skipped');
});

test('中断提问时返回 cancelled，不误判为跳过', async t => {
  const s = bareSession(t);
  const controller = new AbortController();
  const pending = s.ask({ question: '继续吗' }, controller.signal);
  controller.abort();
  assert.equal((await pending).status, 'cancelled');
});

test('自动化来源的提问直接返回 cancelled 并标记需要用户', async t => {
  const s = bareSession(t);
  s.activeRun = { source: 'automation' };
  const outcome = await s.ask({ question: '继续吗' });
  assert.equal(outcome.status, 'cancelled');
  assert.equal(s.permissionBlocked, true);
});

test('关闭会话时未回答的提问记为 cancelled 而不是跳过', async () => {
  const source = fs.readFileSync(new URL('../sessions.mjs', import.meta.url), 'utf8');
  assert.match(source, /askPending\.values\(\)\) p\.finish\(\{ status: 'cancelled'/,
    '会话关闭应记 cancelled；记成 skipped 会让模型以为用户主动放弃');
});
