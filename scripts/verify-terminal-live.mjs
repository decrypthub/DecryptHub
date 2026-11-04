// 真实链路验收：不依赖单元测试替身，直接起真实 SessionManager + 真实 PTY，
// 验证 Agent 能通过 terminal_* 工具驱动一个交互式程序（读提示符 → 发输入 → 读结果）。
//
// 这是"门禁会绿着撒谎"的防线：单测能证明 classifyWait 的四值正确，
// 但证明不了「真实 shell 提示符能被识别」「真实 node-pty 能收到数据」。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { SessionManager } from '../sidecar/sessions.mjs';
import { WORKSPACE_TOOLS } from '../sidecar/workspace.mjs';

const app = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-verify-term-'));
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-verify-work-'));
const settings = { openai: { apiKey: 'x', model: 't' }, mcpServers: {}, subagentMaxActive: 3 };

let failures = 0;
const check = (name, fn) => { try { fn(); console.log('  ✅ ' + name); } catch (e) { failures++; console.log('  ❌ ' + name + ' → ' + e.message); } };

const mgr = new SessionManager({
  userDataDir: app, getSettings: () => settings, broadcast() {}, chromeMod: {},
  hasApprovalListener: () => true,   // 视为有界面，审批不阻断
});
const entry = mgr.workspaces.folder(work);
const project = mgr.projects.save({ name: 'verify', folders: [entry], primaryId: entry.id });
const s = mgr.create({ projectId: project.id, primary: true });
s.setMode('full-access');   // 跳过审批，专注验证工具链路本身

const tool = name => WORKSPACE_TOOLS.find(t => t.name === name);
const ctx = () => s.toolCtx();

console.log('=== 1) terminal_open ===');
const opened = await tool('terminal_open').run({}, ctx());
console.log('  ' + opened.text.split('\n')[0]);
const m = /id=([0-9a-f-]{36})/.exec(opened.text);
const id = m?.[1];
check('打开终端并返回合法 id', () => { assert.ok(id, '没有拿到 id'); });

if (id) {
  console.log('\n=== 2) terminal_send：发一个普通命令 ===');
  const sent = await tool('terminal_send').run({ id, text: 'echo READY_MARKER', waitMs: 8000 }, ctx());
  const reason = /waitReason=(\w+)/.exec(sent.text)?.[1];
  console.log('  waitReason=' + reason + '  输出含 READY_MARKER=' + sent.text.includes('READY_MARKER'));
  check('命令输出可见', () => assert.ok(sent.text.includes('READY_MARKER'), '没看到 READY_MARKER：' + sent.text.slice(0, 300)));
  check('waitReason 是四值之一', () => assert.ok(['stdin_read', 'inferred_idle', 'timeout', 'session_exit'].includes(reason), '非法 waitReason: ' + reason));
  check('拿到提示符后判定 stdin_read（这就是交互可用的证据）', () => assert.equal(reason, 'stdin_read', '实际 ' + reason));

  console.log('\n=== 3) 真实交互：用 node 的 readline 等输入 ===');
  const rl = await tool('terminal_send').run({ id, text: `node -e "process.stdout.write('NAME? '); process.stdin.once('data', d => { process.stdout.write('HI ' + String(d).trim()); process.exit(0); })"`, waitMs: 10000 }, ctx());
  console.log('  第一次 waitReason=' + (/waitReason=(\w+)/.exec(rl.text)?.[1]));
  const answered = await tool('terminal_send').run({ id, text: 'frida', waitMs: 10000 }, ctx());
  const ok2 = answered.text.includes('HI frida');
  const reason2 = /waitReason=(\w+)/.exec(answered.text)?.[1];
  console.log('  第二次 waitReason=' + reason2 + '  含 HI frida=' + ok2);
  check('交互式问答能完成（发输入 → 拿到响应）', () => assert.ok(ok2, answered.text.slice(0, 300)));

  console.log('\n=== 4) terminal_read 只读轮询 ===');
  const read = await tool('terminal_read').run({ id, waitMs: 1500 }, ctx());
  check('terminal_read 不报错', () => assert.ok(!read.isError, read.text));
  check('terminal_read 给出 waitReason', () => assert.match(read.text, /waitReason=/));

  console.log('\n=== 5) session_exit：用 exit 结束整个 shell ===');
  // 注意：不能靠「子进程退出」判断，因为交互式 shell 本身还活着，会立刻印出新提示符。
  // 真正的 session_exit 是顶层 PTY 进程结束 —— 用 exit 触发。
  await tool('terminal_send').run({ id, text: 'exit', waitMs: 8000 }, ctx());
  const after = await tool('terminal_read').run({ id, waitMs: 6000 }, ctx());
  const reason3 = /waitReason=(\w+)/.exec(after.text)?.[1];
  console.log('  退出后 waitReason=' + reason3);
  check('shell 退出后判定 session_exit', () => assert.equal(reason3, 'session_exit', '实际 ' + reason3));

  console.log('\n=== 6) terminal_close ===');
  const closed = await tool('terminal_close').run({ id }, ctx());
  check('关闭成功', () => assert.ok(closed.text.includes('已关闭'), closed.text));
  const again = await tool('terminal_close').run({ id }, ctx());
  check('重复关闭报错而不是崩', () => assert.equal(again.isError, true));
}

console.log('\n=== 6) 输出膨胀：长输出保留尾部 ===');
{
  const big = 'x'.repeat(30000) + 'FINAL_ANSWER_42';
  const { trimToolOutput } = await import('../sidecar/context.mjs');
  const out = trimToolOutput(big, { head: 600 });
  check('长输出的尾部结论可见', () => assert.ok(out.includes('FINAL_ANSWER_42'), '尾部丢了'));
  check('明确标注省略', () => assert.match(out, /中段省略/));
}

console.log('\n=== 7) 审批无界面时立刻拒绝（不挂起）===');
{
  const t0 = Date.now();
  mgr.hasApprovalListener = () => false;
  const s2 = mgr.create({ projectId: project.id });
  s2.setMode('standard');
  let threw = null;
  try { await s2.approve({ name: 'workspace_shell', category: 'shell', scopeKey: 'k' }); } catch (e) { threw = e; }
  const ms = Date.now() - t0;
  check('抛出 approval-unavailable', () => assert.equal(threw?.code, 'approval-unavailable'));
  check('耗时 < 2s（证明没有等 5 分钟）', () => assert.ok(ms < 2000, '实际 ' + ms + 'ms'));
}

await mgr.closeAll();
try { fs.rmSync(app, { recursive: true, force: true }); fs.rmSync(work, { recursive: true, force: true }); } catch {}

console.log('\n' + (failures ? `❌ ${failures} 项失败` : '✅ 全部通过'));
process.exit(failures ? 1 : 0);
