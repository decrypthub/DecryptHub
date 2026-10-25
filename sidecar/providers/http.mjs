// 流式 HTTP 底座：SSE 分帧 + 空闲超时 + 可中断。OpenAI / Anthropic 适配器共用。
// 注意：Bun 下 req.destroy(err) 不一定触发 'error' 事件，原实现会导致 Promise 永不结束（Agent 卡死）。
// 因此所有结束路径都直接 settle，并用 settled 标志防止重复。
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function post(urlStr, headers, body, onChunk, signal, idleMs = 180000) {
  return new Promise((resolve, reject) => {
    let settled = false, idle;
    const ok = () => { if (settled) return; settled = true; clearTimeout(idle); resolve(); };
    const fail = e => { if (settled) return; settled = true; clearTimeout(idle); reject(e); try { req.destroy(); } catch {} };
    const u = new URL(urlStr);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(u, { method: 'POST', headers }, res => {
      let buf = '';
      if (res.statusCode >= 400) {
        let e = '';
        res.on('data', d => (e += d));
        res.on('end', () => {
          const err = new Error(`HTTP ${res.statusCode}: ${e.slice(0, 500)}`);
          err.status = res.statusCode;
          err.body = e.slice(0, 2000);
          err.retryable = res.statusCode === 429 || res.statusCode >= 500;
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
    if (signal) { if (signal.aborted) return fail(new Error('已中断')); signal.addEventListener('abort', () => fail(new Error('已中断')), { once: true }); }
    req.write(JSON.stringify(body));
    req.end();
  });
}

/** 是否值得重试：用户中断、参数错误（4xx）不重试；网络抖动 / 429 / 5xx 重试。 */
export function retryable(e) {
  if (!e || /已中断/.test(e.message)) return false;
  if (e.retryable) return true;
  if (e.status) return e.status === 429 || e.status >= 500;
  return /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|ECONNREFUSED/i.test(e.message);
}

/** SSE 行 → data 负载；非 data 行返回 null。 */
export function sseData(line) {
  if (!line.startsWith('data:')) return null;
  const data = line.slice(5).trim();
  if (!data || data === '[DONE]') return null;
  return data;
}
