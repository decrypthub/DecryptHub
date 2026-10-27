// One retry budget per logical model request. Tool execution is outside this boundary.
import { setTimeout as delay } from 'node:timers/promises';
import { retryable } from './providers/http.mjs';

export const MODEL_MAX_RETRIES = 10;
export function retryDescription(error) {
  if (error.status) return `模型服务暂时不可用（HTTP ${error.status}）`;
  return error.code === 'EMPTY_COMPLETION' ? '模型返回了空响应' : '模型连接或响应流中断';
}
export async function withModelRetries(operation, { signal, onRetry, baseDelayMs = 1000, maxDelayMs = 30000, random = Math.random, wait = delay } = {}) {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    try { return await operation(attempt); }
    catch (error) {
      if (signal?.aborted || attempt >= MODEL_MAX_RETRIES || !retryable(error)) throw error;
      const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.min(attempt, 10));
      const delayMs = Math.min(300000, Math.max(Math.round(backoff * (.8 + .4 * random())), error.retryAfterMs || 0));
      onRetry?.({ attempt: attempt + 1, maxRetries: MODEL_MAX_RETRIES, delayMs, retryAt: Date.now() + delayMs, status: error.status || null, error: retryDescription(error) });
      await wait(delayMs, undefined, { signal });
    }
  }
}
