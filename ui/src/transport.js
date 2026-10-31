// 传输层：WebSocket(与 sidecar 通信) + 原生桥(Tauri 命令：keyring/app_info/restart)
import { invoke as tauriInvoke } from '@tauri-apps/api/core';

const isNative = () => !!(window.__JSRA_NATIVE || window.__TAURI_INTERNALS__ || window.__TAURI__);

// ---------- 原生命令 ----------
export const native = {
  isNative,
  async accountStatus(refresh = false) { return isNative() ? tauriInvoke('account_status', { refresh }) : { available: false, phase: 'signed-out', profile: null, error: null }; },
  async accountAvatar() { return isNative() ? tauriInvoke('account_avatar') : null; },
  async accountLogin() { if (!isNative()) throw new Error('请在桌面应用中登录账号'); return tauriInvoke('account_login'); },
  async accountCancel() { return tauriInvoke('account_cancel'); },
  async accountLogout() { return tauriInvoke('account_logout'); },
  async accountReopenLogin() { return tauriInvoke('account_reopen_login'); },
  async accountOpenPage(page = 'home') { return tauriInvoke('account_open_page', { page }); },
  async appInfo() {
    if (isNative()) { try { return await tauriInvoke('app_info'); } catch {} }
    return { name: 'DecryptHub', version: '1.4.0 (web)', os: 'web', arch: '-', keyringBackend: '进程内存（开发预览，不持久保存）' };
  },
  async secretGet(slot = 'default') {
    throw new Error('已保存的密钥不向界面返回');
  },
  async syncSecrets(slots, activeId) { if (!isNative()) return null; const first = activeId ? 'prov.' + activeId : slots[0]; return await tauriInvoke('secret_sync', { slots: [...new Set([first, ...slots, 'default'].filter(Boolean))] }); },
  async secretSet(slot, v) {
    const s = typeof slot === 'string' ? slot : 'default';
    const value = typeof slot === 'string' ? v : slot; // 兼容 secretSet(value) 旧调用
    if (isNative()) await tauriInvoke('secret_set', { slot: s, value });
    localStorage.removeItem('jsra_key' + (s === 'default' ? '' : ':' + s));
  },
  async secretClear(slot = 'default') {
    if (isNative()) await tauriInvoke('secret_clear', { slot });
    localStorage.removeItem('jsra_key' + (slot === 'default' ? '' : ':' + slot));
  },
  async restartSidecar() { if (isNative()) { try { await tauriInvoke('restart_sidecar'); } catch {} } },
  // 无标题栏布局：双击 drag region 最大化/还原
  async toggleMaximize() { if (!isNative()) return; try { const { getCurrentWindow } = await import('@tauri-apps/api/window'); await getCurrentWindow().toggleMaximize(); } catch {} },
  async startDragging() { if (!isNative()) return; try { const { getCurrentWindow } = await import('@tauri-apps/api/window'); await getCurrentWindow().startDragging(); } catch {} },
  async prepareForUpdate() {
    if (!isNative()) return;
    await tauriInvoke('prepare_for_update');
  },
  // 原生保存对话框；返回绝对路径或 null（用户取消）
  async pickSavePath(defaultName, filterName = 'HAR', ext = 'har') {
    if (isNative()) return await tauriInvoke('pick_save_path', { defaultName, filterName, ext });
    const p = window.prompt('保存到（绝对路径）', '/tmp/' + defaultName); return p || null;
  },
  // 原生打开对话框（可多选）；返回绝对路径数组，取消返回 []
  async pickFiles() {
    if (isNative()) { try { return (await tauriInvoke('pick_open_paths')) || []; } catch { return []; } }
    return [];
  },
  async pickWorkspace(sessionId, recentPath = null) { return isNative() ? await tauriInvoke('pick_work_folder', { sessionId, recentPath }) : null; },
  // 原生嵌入 Chrome 子窗口（Windows / Linux X11）
  async embedSupported() { if (!isNative()) return false; try { return await tauriInvoke('embed_supported'); } catch { return false; } },
  embedShow(a) { return tauriInvoke('embed_show', a); },
  async embedHide() { if (isNative()) { try { await tauriInvoke('embed_hide'); } catch {} } },
  async embedRelease(sessionId) { if (isNative()) { try { await tauriInvoke('embed_release', { sessionId }); } catch {} } },
  async wsPort() { if (isNative()) { try { return await tauriInvoke('get_ws_port'); } catch {} } return null; },
  // sidecar 每次启动换新的一次性票据；拿不到时返回 ''，连接会被 sidecar 拒绝
  async wsToken() { if (isNative()) { try { return await tauriInvoke('get_ws_token'); } catch {} } return null; },
};

// ---------- WebSocket ----------
const listeners = new Map();
const pending = new Map();
let seq = 0, ws = null, ready, queue = [];
let connState = 'connecting';
const stateCbs = new Set();
function setState(s) { connState = s; stateCbs.forEach(cb => cb(s)); }
export const onConnState = cb => { stateCbs.add(cb); cb(connState); return () => stateCbs.delete(cb); };
export const getConnState = () => connState;

// 端口与票据必须成对拿到：sidecar 重启后两者都会变，所以每次（重）连都重新解析一次
async function resolveTarget() {
  if (isNative()) {
    for (let i = 0; i < 40; i++) {
      const [np, nt] = await Promise.all([
        Promise.race([native.wsPort(), new Promise(r => setTimeout(() => r(null), 2000))]),
        Promise.race([native.wsToken(), new Promise(r => setTimeout(() => r(null), 2000))]),
      ]);
      if (window.__JSRA_DEBUG) window.__JSRA_DBGTXT = 'dbg port=' + np + ' token=' + (nt ? 'yes' : 'no') + ' i=' + i;
      if (np && nt) return { port: np, token: nt };
      await new Promise(r => setTimeout(r, 250));
    }
  }
  // 浏览器直连（`npm run dev:ui` + 独立 sidecar）：端口和票据从地址栏参数取，
  // 票据是 sidecar 启动时打在终端上的 JSRA_TOKEN=…
  const q = new URLSearchParams(location.search);
  const port = window.__JSRA_WS_PORT || (q.get('port') ? Number(q.get('port')) : 8777);
  return { port, token: q.get('token') || '' };
}

function connect() {
  ready = new Promise(resolve => {
    (async () => {
      let resolved = false;
      async function open() {
        setState('connecting');
        const { port, token } = await resolveTarget();
        ws = new WebSocket(`${token ? `ws://127.0.0.1:${port}/?token=${encodeURIComponent(token)}` : `ws://127.0.0.1:${port}`}`);
        ws.onopen = () => { setState('connected'); if (!resolved) { resolved = true; resolve(); } queue.forEach(m => ws.send(m)); queue = []; };
        ws.onclose = ev => {
          setState('reconnecting');
          // 1008 = sidecar 主动拒绝（Origin 不符或票据过期），换票据重连一次
          if (ev && ev.code === 1008) console.warn('引擎拒绝了连接（' + (ev.reason || '鉴权失败') + '）。若是浏览器直连，请在地址栏加上 ?token=<sidecar 打印的 JSRA_TOKEN>');
          if (window.__JSRA_DEBUG) window.__JSRA_DBGTXT = 'dbg closed ' + (ev && ev.code);
          setTimeout(() => open().catch(e => { window.__JSRA_DBGTXT = 'dbg err ' + e; setTimeout(open, 2000); }), 1000);
        };
        ws.onerror = () => {};
        ws.onmessage = ev => {
          const m = JSON.parse(ev.data);
          if (m.type === 'reply') { const p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.rej(new Error(m.error)) : p.res(m.result); } }
          else if (m.type === 'event') { (listeners.get(m.channel) || []).forEach(cb => { try { cb(m.payload, m.sid); } catch (e) { console.error(e); } }); }
        };
      }
      open();
    })();
  });
}
connect();

function sendRaw(msg) { ready.then(() => { ws && ws.readyState === 1 ? ws.send(msg) : queue.push(msg); }); }

window.api = {
  invoke(channel, ...args) {
    const id = ++seq;
    const msg = JSON.stringify({ type: 'invoke', id, channel, args: args.length <= 1 ? args[0] : args });
    return new Promise((res, rej) => { pending.set(id, { res, rej }); sendRaw(msg); setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('请求超时，逻辑进程可能繁忙或已退出')); } }, channel === 'download-kernel' ? 900000 : 130000); });
  },
  sendInput(ev) { sendRaw(JSON.stringify({ type: 'input', payload: ev })); },
  on(channel, cb) { if (!listeners.has(channel)) listeners.set(channel, new Set()); listeners.get(channel).add(cb); return () => listeners.get(channel)?.delete(cb); },
};
