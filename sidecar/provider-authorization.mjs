// Provider-owned sign-in with cancellable notices/prompts; credentials never enter history.
import crypto from 'node:crypto';
import { catalogLogin } from './provider-catalog.mjs';
export class ProviderAuthorization {
  constructor({ settings, emit }) { this.settings = settings; this.emit = emit; this.attempts = new Map(); }
  status(id) { const attempt = this.attempts.get(id); if (!attempt) throw Error('登录请求不存在'); return { id, routeId: attempt.routeId, status: attempt.status, notice: attempt.notice, prompt: attempt.question?.public, error: attempt.error }; }
  publish(attempt) { this.emit(this.status(attempt.id)); }
  start(routeId, method) {
    const route = this.settings().providers?.find(route => route.id === routeId); if (!route?.catalogId) throw Error('请先保存内置供应商渠道');
    for (const [id, attempt] of this.attempts) if (this.attempts.size >= 32 && attempt.status !== 'pending') this.attempts.delete(id);
    for (const attempt of this.attempts.values()) if (attempt.routeId === routeId && attempt.status === 'pending') this.cancel(attempt.id);
    const attempt = { id: crypto.randomUUID(), routeId, catalogId: route.catalogId, controller: new AbortController(), status: 'pending' }; this.attempts.set(attempt.id, attempt);
    void catalogLogin(routeId, route.catalogId, method, { signal: attempt.controller.signal,
      notify: notice => { attempt.notice = notice; this.publish(attempt); },
      prompt: prompt => new Promise((resolve, reject) => {
        const signal = prompt.signal ? AbortSignal.any([attempt.controller.signal, prompt.signal]) : attempt.controller.signal;
        const promptId = crypto.randomUUID(), abort = () => settle(reject, signal.reason || Error('登录已取消'));
        const settle = (finish, value) => { signal.removeEventListener('abort', abort); if (attempt.question?.public.id === promptId) attempt.question = null; this.publish(attempt); finish(value); };
        attempt.question = { public: { id: promptId, type: prompt.type, message: prompt.message, placeholder: prompt.placeholder, options: prompt.options }, answer: value => settle(resolve, value) };
        signal.addEventListener('abort', abort, { once: true }); this.publish(attempt); if (signal.aborted) abort();
      }),
    }).then(() => { attempt.status = 'completed'; attempt.question = null; this.publish(attempt); }, error => { attempt.status = attempt.controller.signal.aborted ? 'cancelled' : 'failed'; attempt.error = attempt.status === 'failed' ? error.message : null; attempt.question = null; this.publish(attempt); });
    return this.status(attempt.id);
  }
  answer(id, promptId, value) { const attempt = this.attempts.get(id); if (!attempt || attempt.status !== 'pending' || attempt.question?.public.id !== promptId) throw Error('登录问题已结束，请查看最新状态'); if (typeof value !== 'string' || value.length > 100000) throw Error('登录输入无效'); attempt.question.answer(value); return true; }
  cancel(id) { this.attempts.get(id)?.controller.abort(Error('用户取消登录')); return true; }
  url(id) { const state = this.status(id), notice = state.notice; if (state.status !== 'pending') throw Error('登录流程已结束'); const value = notice?.url || notice?.verificationUri || notice?.links?.[0]?.url; const url = new URL(value); if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1','localhost'].includes(url.hostname))) throw Error('登录链接不受支持'); return url.href; }
  reconcile() { for (const attempt of this.attempts.values()) if (attempt.status === 'pending' && !this.settings().providers?.some(route => route.id === attempt.routeId && route.catalogId === attempt.catalogId)) this.cancel(attempt.id); }
  close() { for (const attempt of this.attempts.values()) attempt.controller.abort(Error('应用关闭')); }
}
