// 审批记忆与 goal_update 报错文案：这两处都直接决定长链路任务能不能顺畅跑完。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Agent } from '../agent.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wdh-approve-'));
const WORKSPACE = { id: 'ws', root: 'C:/ws', revision: 1 };
const PAGE_URL = 'https://target.example/form';

function agentWith(approvals, { mode = 'standard', answer = () => true } = {}) {
  return new Agent({
    tools: [],
    browser: { activePage: { url: () => PAGE_URL, isClosed: () => false } },
    mcp: { tools: [], has: () => false }, projectDir: tmp(),
    getSettings: () => ({ maxTokens: 1000 }),
    emit: () => {},
    getMode: () => mode,
    getWorkspace: () => WORKSPACE,
    getToolContext: () => ({ workRoot: WORKSPACE.root, workspaceId: WORKSPACE.id, mode, readHashes: new Map() }),
    currentUrl: () => PAGE_URL,
    fileSize: () => 0,
    approve: async (req) => { approvals.push(req); return answer(req); },
  });
}

const clickTool = { name: 'browser_click', description: 'x', schema: { type: 'object', properties: {}, additionalProperties: false }, run: async () => ({ text: 'clicked' }) };
const fillTool = { name: 'browser_fill', description: 'x', schema: { type: 'object', properties: { value: { type: 'string' } }, additionalProperties: false }, run: async () => ({ text: 'filled' }) };

test('tool approval offers a rememberable scope instead of always one-shot', async () => {
  const seen = [];
  const agent = agentWith(seen);
  agent.localTools = [clickTool];
  await agent.runTool('browser_click', {});
  assert.equal(seen.length, 1);
  assert.equal(seen[0].canRemember, true, '重复的表单操作必须能记住');
  assert.ok(seen[0].scopeKey, '记住的依据是稳定的 scopeKey');
  assert.match(seen[0].summary, /target\.example/, '审批卡片要说明作用于哪个页面');
});

test('the remembered scope is bound to the exact arguments', async () => {
  const seen = [];
  const agent = agentWith(seen);
  agent.localTools = [fillTool];
  await agent.runTool('browser_fill', { value: '第一个字段' });
  await agent.runTool('browser_fill', { value: '第二个字段' });
  assert.equal(seen.length, 2);
  assert.notEqual(seen[0].scopeKey, seen[1].scopeKey, '不同参数是不同的授权范围');
});

test('rejection tells the model what to ask for', async () => {
  const seen = [];
  const agent = agentWith(seen, { answer: () => false });
  agent.localTools = [clickTool];
  const r = await agent.runTool('browser_click', {});
  assert.equal(r.isError, true);
  assert.match(r.text, /本对话允许相同动作/, '拒绝要给出可执行的补救方式');
  assert.match(r.text, /只读/, '并说明可以改用只读步骤');
});

test('goal_update errors name the actual reason', () => {
  const source = fs.readFileSync(new URL('../sessions.mjs', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('updateGoal(value, { revision } = {})'));
  assert.match(body, /当前没有长期目标/, '没有目标');
  assert.match(body, /当前目标状态是/, '目标已 blocked/paused');
  assert.match(body, /不是目标续跑轮次/, '当前轮次不是 goal 轮');
  assert.doesNotMatch(body.slice(0, 900), /只有用户通过 \/goal 启动的当前目标可以更新/, '不能再用一句笼统的文案');
});
