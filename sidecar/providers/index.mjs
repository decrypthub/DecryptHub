// Provider 解析：把 settings 变成可调用的适配器对象 { id, complete(messages, tools, hooks) }。
// Agent 只依赖这个接口，测试可注入假 provider（见 test/loop.test.mjs）。
import { completeOpenAI } from './openai.mjs';
import { completeAnthropic } from './anthropic.mjs';
import { withModelRetries } from '../model-retry.mjs';
import { requestThinking } from '../thinking.mjs';
import { completeResponses } from './pi-ai.mjs';

export const PROVIDERS = {
  openai: {
    cfg: s => ({ ...s.openai, providerId: s.activeProviderId || null, temperature: s.temperature, maxTokens: s.openai?.maxTokens ?? s.openaiMaxTokens, idleTimeoutMs: s.idleTimeoutMs, thinking: requestThinking(s, 'openai') }),
    complete: completeOpenAI,
  },
  anthropic: {
    cfg: s => ({ ...s.anthropic, providerId: s.activeProviderId || null, temperature: s.temperature, maxTokens: s.anthropic?.maxTokens ?? s.maxTokens, idleTimeoutMs: s.idleTimeoutMs, thinking: requestThinking(s, 'anthropic') }),
    complete: completeAnthropic,
  },
};

/** @returns {{ id:'openai'|'anthropic', complete:(messages:any[],tools:any[],hooks:any)=>Promise<any> }} */
export function resolveProvider(settings) {
  const id = settings?.provider === 'anthropic' ? 'anthropic' : 'openai';
  const p = PROVIDERS[id];
  const key = id === 'anthropic' ? settings.anthropic?.apiKey : settings.openai?.apiKey;
  if (!key && !settings[id]?.catalogProviderId) throw new Error('尚未配置 API Key，请在「设置」页填写后重试');
  const cfg = p.cfg(settings || {});
  if (!cfg.catalogProviderId && cfg.api && !['openai-completions', 'openai-responses', 'anthropic-messages'].includes(cfg.api)) throw Error('尚未支持所选接口类型：' + cfg.api);
  if (!cfg.catalogProviderId && (cfg.api === 'anthropic-messages' && id !== 'anthropic' || cfg.api?.startsWith('openai-') && id !== 'openai')) throw Error('供应商接口类型与渠道协议不匹配');
  const complete = cfg.catalogProviderId || cfg.api === 'openai-responses' ? completeResponses : p.complete;
  return { id, cfg, complete: (messages, tools, hooks = {}) => hooks.managedRetry ? complete(cfg, messages, tools, hooks) : withModelRetries(() => complete(cfg, messages, tools, hooks), { signal: hooks.signal, onRetry: hooks.onRetry, baseDelayMs: cfg.retryBaseMs ?? 1000 }) };
}

/** 兼容旧入口：chat(settings, messages, tools, hooks) */
export async function chat(settings, messages, tools, hooks) {
  return resolveProvider(settings).complete(messages, tools, hooks);
}
