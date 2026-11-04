// 文件浏览面板的真实链路验收。
//
// 单测能证明状态机对，但证明不了三件只有真跑才知道的事：
//   ① `workspace-directory` 返回的契约真的带 `type`，失败真的带错误码；
//   ② `fs.watch` 真的会在文件变化时回推 `workspace-directory-changed`；
//   ③ 监听会随展开集正确开关，且会话关闭后不再上报。
//
// 起一个隔离的数据目录与端口，不碰用户正在用的实例。
// 用法：node scripts/verify-files-live.mjs
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const ROOT = process.cwd();
const PORT = Number(process.env.FILES_VERIFY_PORT || 8791);
const TOKEN = 'files-verify';
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'wdh-files-'));
const WORKSPACE = path.join(DATA, 'workspace');
fs.mkdirSync(path.join(WORKSPACE, 'src', 'deep'), { recursive: true });
fs.writeFileSync(path.join(WORKSPACE, 'README.md'), '# fixture\n');
fs.writeFileSync(path.join(WORKSPACE, 'src', 'main.js'), 'console.log(1)\n');
fs.writeFileSync(path.join(WORKSPACE, '.env'), 'SECRET=1\n');

let pass = 0, fail = 0;
const check = (ok, label, extra = '') => {
  if (ok) { console.log('  ✓ ' + label); pass++; }
  else { console.log('  ✗ ' + label + (extra ? ' — ' + extra : '')); fail++; }
};

const sidecar = spawn(process.execPath, [path.join(ROOT, 'sidecar', 'index.mjs')], {
  cwd: ROOT,
  env: { ...process.env, DECRYPTHUB_DATA_DIR: path.join(DATA, 'DecryptHub'), JSRA_WS_PORT: String(PORT), JSRA_WS_TOKEN: TOKEN },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stderr = '';
sidecar.stderr.on('data', d => { stderr += String(d); });

await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('sidecar 未就绪：' + stderr.slice(-800))), 25000);
  sidecar.stdout.on('data', d => { if (/JSRA_PORT=/.test(String(d))) { clearTimeout(timer); resolve(); } });
});

const ws = new WebSocket(`ws://127.0.0.1:${PORT}/?token=${TOKEN}`, { headers: { Origin: 'http://127.0.0.1' } });
await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });

let seq = 0;
const waiting = new Map(), events = [];
ws.on('message', raw => {
  const message = JSON.parse(String(raw));
  if (message.type === 'reply') {
    const pending = waiting.get(message.id);
    if (!pending) return;
    waiting.delete(message.id);
    if (message.error) { const error = new Error(message.error); error.code = message.code; pending.reject(error); }
    else pending.resolve(message.result);
  } else if (message.type === 'event') {
    events.push(message);
  }
});
const invoke = (channel, args) => new Promise((resolve, reject) => {
  const id = ++seq;
  waiting.set(id, { resolve, reject });
  ws.send(JSON.stringify({ type: 'invoke', id, channel, args }));
  setTimeout(() => { if (waiting.delete(id)) reject(new Error(channel + ' 超时')); }, 20000);
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 6000) => {
  for (const deadline = Date.now() + ms; Date.now() < deadline;) {
    const value = fn();
    if (value) return value;
    await sleep(60);
  }
  return undefined;
};

try {
  // 装一个项目并把工作目录指向 fixture。
  // 项目目录必须走授权凭证（`grants.mjs` 的签名），这里按同一算法签一张，
  // 保证验收走的是真实授权链路，而不是绕过它。
  const grantFor = (target, sessionIdFor = 'main') => {
    const grant = { path: target, sessionId: sessionIdFor, expiresAt: Date.now() + 60000 };
    grant.signature = createHmac('sha256', TOKEN).update(`${grant.sessionId}\n${grant.path}\n${grant.expiresAt}`).digest('hex');
    return grant;
  };
  await invoke('project-save', {
    project: { name: 'files-fixture', folders: [{ key: 'a', grant: grantFor(WORKSPACE) }], primaryKey: 'a' },
    sessionId: 'main',
  });
  const listing = await invoke('projects-list');
  const projects = listing.projects || listing;
  const project = projects.find(p => p.name === 'files-fixture') || projects[0];
  const created = await invoke('session-create', { projectId: project.id });
  const sessionId = created.id || created.sessionId;
  if (!sessionId) throw new Error('拿不到会话 id：' + JSON.stringify(session));

  console.log('\n① 目录契约（对齐 DSH WorkspaceDirectoryEntry）');
  const root = await invoke('workspace-directory', { sessionId });
  check(typeof root.path === 'string' && path.isAbsolute(root.path), '一层返回自己的绝对路径', root.path);
  check(root.entries.every(e => typeof e.name === 'string' && ['file', 'directory', 'other'].includes(e.type)), '条目只有 name/type(/size)', JSON.stringify(root.entries));
  check(!root.entries.some(e => e.name === '.env'), '敏感文件不列出（与 Agent 工具同一道边界）');
  check(root.entries.find(e => e.name === 'src')?.type === 'directory', 'src 报 directory');
  check(root.entries.find(e => e.name === 'README.md')?.type === 'file', 'README.md 报 file');
  check(typeof root.entries.find(e => e.name === 'README.md')?.size === 'number', '文件带 size');
  check(root.entries.map(e => e.name).indexOf('src') < root.entries.map(e => e.name).indexOf('README.md'), '目录排在文件之前');

  console.log('\n② 失败带可路由的错误码');
  const outside = await invoke('workspace-directory', { sessionId, path: '../../..' }).then(() => null, e => e);
  check(!!outside, '越界路径被拒绝');
  check(outside?.code === 'workspace-file/outside-workspace', '错误码是 outside-workspace', outside?.code);
  const missing = await invoke('workspace-directory', { sessionId, path: 'no-such-dir' }).then(() => null, e => e);
  check(missing?.code === 'workspace-file/not-found', '不存在 → not-found', missing?.code);
  const notDir = await invoke('workspace-directory', { sessionId, path: 'README.md' }).then(() => null, e => e);
  check(notDir?.code === 'workspace-file/not-directory', '文件当目录 → not-directory', notDir?.code);

  console.log('\n③ 目录监听真的回推变化');
  const srcPath = path.join(root.path, 'src');
  const watch = await invoke('workspace-watch', { sessionId, paths: [root.path, srcPath] });
  check(watch.watching === 2, '两条监听已建立', JSON.stringify(watch));
  await sleep(300);
  const before = events.length;
  fs.writeFileSync(path.join(srcPath, 'added.js'), 'x\n');
  const changed = await until(() => events.slice(before).find(e => e.channel === 'workspace-directory-changed'));
  check(!!changed, '新增文件触发 workspace-directory-changed');
  check(changed?.payload?.paths?.includes(srcPath), '上报的是变化的那一层（不是整棵树）', JSON.stringify(changed?.payload));
  check(changed?.sid === sessionId, '事件带会话 id，不会串到别的会话');

  // 变化后重列能读到新文件
  const relisted = await invoke('workspace-directory', { sessionId, path: 'src' });
  check(relisted.entries.some(e => e.name === 'added.js'), '重列能看到新文件');

  console.log('\n④ 监听随展开集开关');
  const narrowed = await invoke('workspace-watch', { sessionId, paths: [root.path] });
  check(narrowed.watching === 1, '收窄到 1 条', JSON.stringify(narrowed));
  await sleep(300);
  const beforeNarrow = events.length;
  fs.writeFileSync(path.join(srcPath, 'ignored.js'), 'x\n');
  await sleep(700);
  check(!events.slice(beforeNarrow).some(e => e.channel === 'workspace-directory-changed'),
    '已收起的目录不再上报（监听真的被关掉了）');
  const rootChange = await (async () => {
    fs.writeFileSync(path.join(root.path, 'top.md'), 'x\n');
    return until(() => events.slice(beforeNarrow).find(e => e.channel === 'workspace-directory-changed'), 4000);
  })();
  check(!!rootChange, '仍展开的根继续上报');

  console.log('\n⑤ 清空监听与会话关闭');
  const cleared = await invoke('workspace-watch', { sessionId, paths: [] });
  check(cleared.watching === 0, '可以清空全部监听', JSON.stringify(cleared));
  await sleep(300);
  const beforeClear = events.length;
  fs.writeFileSync(path.join(root.path, 'quiet.md'), 'x\n');
  await sleep(700);
  check(!events.slice(beforeClear).some(e => e.channel === 'workspace-directory-changed'), '清空后不再上报');

  await invoke('workspace-watch', { sessionId, paths: [root.path] });
  await invoke('session-close', { sessionId });
  await sleep(300);
  const beforeClose = events.length;
  fs.writeFileSync(path.join(root.path, 'after-close.md'), 'x\n');
  await sleep(700);
  check(!events.slice(beforeClose).some(e => e.channel === 'workspace-directory-changed'), '会话关闭后监听一并释放');
} catch (error) {
  console.log('\n  ✗ 验收中断：' + error.message);
  fail++;
} finally {
  try { ws.close(); } catch {}
  sidecar.kill();
  await sleep(200);
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch {}
}

console.log(`\n${fail ? '失败' : '通过'}：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
