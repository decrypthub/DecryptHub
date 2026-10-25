// Provider 解析：把 settings 变成可调用的适配器对象 { id, complete(messages, tools, hooks) }。
// Agent 只依赖这个接口，测试可注入假 provider（见 test/loop.test.mjs）。
import { completeOpenAI } from './openai.mjs';
import { completeAnthropic } from './anthropic.mjs';

export const PROVIDERS = {
  openai: {
    cfg: s => ({ ...s.openai, temperature: s.temperature, maxTokens: s.openaiMaxTokens, idleTimeoutMs: s.idleTimeoutMs }),
    complete: completeOpenAI,
  },
  anthropic: {
    cfg: s => ({ ...s.anthropic, temperature: s.temperature, maxTokens: s.maxTokens, idleTimeoutMs: s.idleTimeoutMs }),
    complete: completeAnthropic,
  },
};

/** @returns {{ id:'openai'|'anthropic', complete:(messages:any[],tools:any[],hooks:any)=>Promise<any> }} */
export function resolveProvider(settings) {
  const id = settings?.provider === 'anthropic' ? 'anthropic' : 'openai';
  const p = PROVIDERS[id];
  const key = id === 'anthropic' ? settings.anthropic?.apiKey : settings.openai?.apiKey;
  if (!key) throw new Error('尚未配置 API Key，请在「设置」页填写后重试');
  const cfg = p.cfg(settings || {});
  return { id, cfg, complete: (messages, tools, hooks) => p.complete(cfg, messages, tools, hooks) };
}

/** 兼容旧入口：chat(settings, messages, tools, hooks) */
export async function chat(settings, messages, tools, hooks) {
  return resolveProvider(settings).complete(messages, tools, hooks);
}
