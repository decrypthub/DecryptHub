// 安装后验收：直接驱动**已安装目录里**的捆绑 Node + 侧车产物，验证真实安装包能工作。
//
// 为什么不能只信 check-sidecar.mjs：它验的是 build/resources（构建产物），
// 而安装包多了一层 NSIS 打包/解包。资源少一个、路径被改写、权限被改，
// 都是「构建通过、装完不能用」的典型形态。
//
// 用法：node scripts/verify-installed.mjs <安装目录>
//   安装目录下应有 resources/node/node.exe 与 resources/sidecar/main.mjs
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { folderProof } from '../sidecar/grants.mjs';

const installDir = process.argv[2];
if (!installDir) { console.error('用法：node scripts/verify-installed.mjs <安装目录>'); process.exit(2); }

const nodeExe = path.join(installDir, 'resources', 'node', 'node.exe');
const entry = path.join(installDir, 'resources', 'sidecar', 'main.mjs');
const exe = path.join(installDir, 'DecryptHub.exe');

let failed = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ' — ' + extra : ''}`);
  if (!ok) failed++;
};

check('安装目录里有主程序', fs.existsSync(exe));
check('安装目录里有捆绑 Node', fs.existsSync(nodeExe));
check('安装目录里有侧车产物', fs.existsSync(entry));
if (failed) process.exit(1);

// 隔离运行：数据目录、HOME、TEMP 全部指到临时目录，绝不碰用户真实的 %APPDATA%\DecryptHub
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wdh-installed-'));
const token = 'verify-' + Math.random().toString(36).slice(2);
const child = spawn(nodeExe, [entry], {
  cwd: path.dirname(nodeExe),
  windowsHide: true,
  env: {
    ...process.env,
    DECRYPTHUB_DATA_DIR: path.join(tmpRoot, 'data'),
    APPDATA: tmpRoot, HOME: tmpRoot, XDG_CONFIG_HOME: tmpRoot, TEMP: tmpRoot, TMP: tmpRoot, TMPDIR: tmpRoot,
    JSRA_MODE: 'server', JSRA_WS_PORT: '0', JSRA_WS_TOKEN: token, JSRA_NATIVE_HOST: '0', JSRA_DEV: '0', DECRYPTHUB_WDH_DIR: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '', stderr = '';
child.stdout.on('data', d => { stdout += d.toString(); });
child.stderr.on('data', d => { stderr += d.toString(); });

const waitFor = (re, ms = 30000) => new Promise((resolve, reject) => {
  const started = Date.now();
  const tick = () => {
    const m = stdout.match(re);
    if (m) return resolve(m);
    if (Date.now() - started > ms) return reject(new Error(`超时等待 ${re}；stdout=${stdout.slice(0, 500)} stderr=${stderr.slice(0, 500)}`));
    setTimeout(tick, 50);
  };
  tick();
});

let socket;
try {
  const m = await waitFor(/JSRA_PORT=(\d+)/);
  const port = m[1];
  check('侧车完成监听并交出端口', !!port, `port=${port}`);

  socket = new WebSocket(`ws://127.0.0.1:${port}/?token=${token}`);
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
    setTimeout(() => reject(new Error('WS 连接超时')), 15000);
  });
  check('WS 握手成功（token 校验通过）', true);

  let seq = 0;
  const pending = new Map();
  socket.on('message', raw => {
    let m2; try { m2 = JSON.parse(raw); } catch { return; }
    // 协议：{type:'reply', id, result, error}
    if (m2.type === 'reply' && pending.has(m2.id)) { pending.get(m2.id)(m2); pending.delete(m2.id); }
  });
  // 协议：{type:'invoke', id, channel, args}
  const invoke = (channel, args = {}, timeoutMs = 30000) => new Promise((resolve, reject) => {
    const id = 'r' + (++seq);
    pending.set(id, resolve);
    socket.send(JSON.stringify({ type: 'invoke', id, channel, args }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`调用超时 ${channel}`)); } }, timeoutMs);
  });

  // 1) 会话服务可用：空数据目录下需要先建项目 → 再建会话（与 check-sidecar.mjs 同一套流程）
  const projectDir = path.join(tmpRoot, 'workspace');
  fs.mkdirSync(projectDir, { recursive: true });
  const grant = { sessionId: 'verify-scope', path: projectDir, expiresAt: Date.now() + 60000 };
  grant.signature = folderProof(token, grant);
  const project = (await invoke('project-save', { scope: 'verify-scope', project: { name: 'Installed verify', folders: [{ key: 'main', grant }], primaryKey: 'main' } })).result;
  check('项目可创建（folderProof 签名通过）', !!project?.id, JSON.stringify(project).slice(0, 120));
  const created = (await invoke('session-create', { projectId: project.id })).result;
  check('会话可创建', !!created?.id, JSON.stringify(created).slice(0, 120));
  const sessionId = created?.id;

  // 2) 工具注册表（核心工具必须在，浏览器工具不该默认暴露）
  const tools = await invoke('list-tools', { sessionId });
  const names = (tools?.result || []).map(t => t?.name).filter(Boolean);
  check('工具注册表已加载', names.length > 0, `${names.length} 个工具`);
  check('核心工具 component_list 在册', names.includes('component_list'), names.slice(0, 8).join(','));
  check('浏览器工具未默认暴露（核心包不含 WDH）', !names.includes('browser_open'), names.filter(n => n.startsWith('browser_')).join(',') || '（无）');

  // 3) 核心包里没有 WDH：浏览器能力必须给出可执行的错误，而不是静默不可用
  const opened = (await invoke('browser-launch', { sessionId, url: 'https://example.com' })).result;
  check('缺 WDH 时浏览器给出可操作提示', !opened?.ok && /WDH/.test(opened?.error || ''), JSON.stringify(opened).slice(0, 140));

  // 4) 真实 PTY：输入 → 拿到回显 → 关闭。这是安装后最容易坏的资源（terminal 目录要完整）。
  //    终端属于需要审批的操作：没有确认界面时会被直接拒绝（fail closed），
  //    所以先切到 full-access，走的仍是真实的权限判定路径，不是绕过。
  await invoke('session-set-mode', { sessionId, mode: 'full-access' });
  const termId = crypto.randomUUID();
  let ptyOk = false, ptyNote = '';
  try {
    const openedTerm = await invoke('terminal-open', { sessionId, id: termId, cols: 90, rows: 25 });
    if (openedTerm?.error) ptyNote = 'terminal-open 报错: ' + openedTerm.error;
    const sent = await invoke('terminal-input', { sessionId, id: termId, data: "Write-Output ('INSTALLED_' + 'PTY_OK')\r" });
    if (sent?.error) ptyNote = (ptyNote ? ptyNote + ' | ' : '') + 'terminal-input 报错: ' + sent.error;
    let out = '';
    const deadline = Date.now() + 30000;
    while (!out.includes('INSTALLED_PTY_OK')) {
      if (Date.now() > deadline) { ptyNote = (ptyNote ? ptyNote + ' | ' : '') + '30s 内未见回显，最后输出: ' + JSON.stringify(out.slice(-300)); break; }
      const snap = await invoke('terminal-snapshot', { sessionId, id: termId });
      if (snap?.error) { ptyNote = (ptyNote ? ptyNote + ' | ' : '') + 'terminal-snapshot 报错: ' + snap.error; break; }
      out = snap?.result?.output || '';
      await new Promise(r => setTimeout(r, 50));
    }
    ptyOk = out.includes('INSTALLED_PTY_OK');
    await invoke('terminal-close', { sessionId, id: termId }).catch(() => {});
  } catch (e) { ptyNote = e.message; }
  check('真实 PTY 输入/回显/关闭（安装后）', ptyOk, ptyNote);

  // 4) 正常关停
  await invoke('prepare-exit').catch(() => {});
  const exited = await new Promise(resolve => {
    child.once('exit', code => resolve(true));
    setTimeout(() => resolve(false), 15000);
  });
  check('可正常关停并退出', exited);
} catch (e) {
  check('整体流程', false, e.message);
} finally {
  try { socket?.close(); } catch {}
  if (child.exitCode === null) { try { child.kill(); } catch {} }
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
}

console.log(failed ? `\n${failed} 项失败` : '\n安装后验收全部通过');
process.exit(failed ? 1 : 0);
