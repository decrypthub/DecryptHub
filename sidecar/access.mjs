// WebSocket 接入控制：谁可以连 sidecar。
//
// 之前只有 Origin 白名单，而「浏览器会带 Origin、本机其它程序不会带」——
// 不带 Origin 的连接被直接放行，也就是说本机任意进程都能调到完整 RPC。
// 现在要求握手必须带上本次启动生成的 token（由 Rust 从 sidecar stdout 读走再交给前端）。
//
// 纯函数、零依赖，便于单测（test/access.test.mjs）。

const ORIGIN_RE = /^(tauri:\/\/|https?:\/\/(tauri\.localhost|127\.0\.0\.1|localhost)(:\d+)?$)/i;

/**
 * 浏览器来源是否可信。空 Origin（非浏览器客户端）交给 token 兜底。
 * 注意 'null' 是真实存在的 Origin 值（file:// 页面、沙箱 iframe），必须拒绝。
 */
export function allowOrigin(origin, { extra = [] } = {}) {
  const o = String(origin || '');
  if (!o) return true;
  if (o === 'null') return false;
  if (ORIGIN_RE.test(o)) return true;
  return extra.some(x => x && o === x);
}

/** 从握手请求里取 token：?token= 查询参数、x-jsra-token 头，或 Sec-WebSocket-Protocol: jsra.<token> */
export function tokenFromReq(req) {
  try {
    const url = new URL(String(req?.url || '/'), 'http://127.0.0.1');
    const q = url.searchParams.get('token');
    if (q) return q;
  } catch { /* 交给 header */ }
  const h = req?.headers || {};
  const direct = h['x-jsra-token'];
  if (direct) return String(direct);
  const proto = String(h['sec-websocket-protocol'] || '');
  for (const part of proto.split(',')) {
    const s = part.trim();
    if (s.startsWith('jsra.')) return s.slice(5);
  }
  return '';
}

/** 定长比较，避免逐字节提前返回泄露有效前缀 */
export function safeEqual(a, b) {
  const x = String(a ?? ''), y = String(b ?? '');
  if (!x || !y || x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

/** 一次握手的完整判断：返回 null 表示放行，否则给出关闭原因（可直接喂 ws.close） */
export function denyReason(req, token, { extraOrigins = [] } = {}) {
  // Origin 永远要过；没有配置 token 时（例如只读调试）只靠它
  if (!allowOrigin(req?.headers?.origin, { extra: extraOrigins })) return 'origin';
  if (!token) return null;
  if (!safeEqual(tokenFromReq(req), token)) return 'token';
  return null;
}
