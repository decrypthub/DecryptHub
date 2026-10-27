// 流式 HTTP 底座：SSE 分帧 + 空闲超时 + 可中断。OpenAI / Anthropic 适配器共用。
// 注意：Bun 下 req.destroy(err) 不一定触发 'error' 事件，原实现会导致 Promise 永不结束（Agent 卡死）。
// 因此所有结束路径都直接 settle，并用 settled 标志防止重复。
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

export function post(urlStr, headers, body, onChunk, signal, idleMs = 180000) {
  return new Promise((resolve, reject) => {
    let settled = false, idle, abortListener;
    const cleanup = () => { clearTimeout(idle); if (abortListener) signal.removeEventListener('abort', abortListener); };
    const ok = () => { if (settled) return; settled = true; cleanup(); resolve(); };
    const fail = e => { if (settled) return; settled = true; cleanup(); reject(e); try { req.destroy(); } catch {} };
    const u = new URL(urlStr);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(u, { method: 'POST', headers }, res => {
      let buf = '';
      if (res.statusCode >= 400) {
        let e = '';
        res.on('data', d => { arm(); if (e.length < 2000) e += d.toString().slice(0, 2000 - e.length); });
        res.on('error', fail);
        res.on('aborted', () => fail(Object.assign(new Error('连接被服务器中断'), { retryable: true })));
        res.on('end', () => {
          const err = new Error(`HTTP ${res.statusCode}: ${e.slice(0, 500)}`);
          err.status = res.statusCode;
          err.body = e.slice(0, 2000);
          const after = res.headers['retry-after'];
          err.retryAfterMs = after ? (/^\d+(?:\.\d+)?$/.test(after) ? Number(after) * 1000 : Math.max(0, Date.parse(after) - Date.now())) || 0 : 0;
          fail(err);
        });
        return;
      }
      res.setEncoding('utf8');
      res.on('data', d => { if (settled) return; arm(); buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); try { onChunk(line); } catch (e) { return fail(e); } } });
      res.on('end', () => { try { if (buf) onChunk(buf); ok(); } catch (e) { fail(e); } });
      res.on('error', fail);
      res.on('aborted', () => fail(Object.assign(new Error('连接被服务器中断'), { retryable: true })));
    });
    function arm() { clearTimeout(idle); idle = setTimeout(() => fail(Object.assign(new Error(`模型响应超时（${Math.round(idleMs / 1000)}s 无数据）`), { retryable: true })), idleMs); }
    arm();
    req.on('error', fail);
    if (signal) { if (signal.aborted) return fail(new Error('已中断')); abortListener = () => fail(new Error('已中断')); signal.addEventListener('abort', abortListener, { once: true }); }
    req.write(JSON.stringify(body));
    req.end();
  });
}

/** 是否值得重试：用户中断、参数错误（4xx）不重试；网络抖动 / 429 / 5xx 重试。 */
export function retryable(e) {
  if (!e || /已中断/.test(e.message)) return false;
  if (e.name === 'AbortError') return false;
  if (e.status) return [408, 409, 425, 429].includes(e.status) || e.status >= 500;
  if (typeof e.retryable === 'boolean') return e.retryable;
  return /ECONNRESET|ETIMEDOUT|EPIPE|EAI_AGAIN|ENOTFOUND|socket hang up|ECONNREFUSED|timed out|terminated|idle|超时|连接被服务器中断/i.test(e.code || '') || /ECONNRESET|ETIMEDOUT|EPIPE|EAI_AGAIN|ENOTFOUND|socket hang up|ECONNREFUSED|timed out|terminated|idle|超时|连接被服务器中断/i.test(e.message || '');
}

export function modelStreamError(value = {}) {
  const type = String(value.type || value.code || '');
  const status = Number(value.status || value.status_code) || (/authentication|invalid_api_key/.test(type) ? 401 : /permission|insufficient_quota|billing/.test(type) ? 403 : /invalid_request/.test(type) ? 400 : /not_found/.test(type) ? 404 : /rate_limit/.test(type) ? 429 : /overloaded/.test(type) ? 529 : null);
  return Object.assign(new Error('模型返回错误: ' + String(value.message || type || '响应流中断').slice(0, 300)), { status, retryable: !status || [408, 409, 425, 429].includes(status) || status >= 500 });
}

/** SSE 行 → data 负载；非 data 行返回 null。 */
export function sseData(line) {
  if (!line.startsWith('data:')) return null;
  const data = line.slice(5).trim();
  if (!data || data === '[DONE]') return null;
  return data;
}
