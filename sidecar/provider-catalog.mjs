// Catalog providers retain their own protocol/auth implementations, as DSH does.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { builtinProviders, builtinModels } from '@earendil-works/pi-ai/providers/all';
import { ALL_LEVELS } from './thinking.mjs';
const providers = new Map(builtinProviders().map(provider => [provider.id, provider]));
const records = new Map(), chains = new Map(); let persist;
export function configureCatalogCredentials({ values, save } = {}) {
  if (save) persist = save;
  if (values) for (const [slot, value] of Object.entries(values)) if (slot.startsWith('prov.')) {
    const id = slot.slice(5); if (!value) { records.delete(id); continue; }
    let credential; try { credential = JSON.parse(value); } catch { credential = { type: 'api_key', key: value }; }
    if (!['api_key', 'oauth'].includes(credential?.type)) credential = { type: 'api_key', key: value };
    records.set(id, credential);
  }
}
export function catalogCredentialStatus(id) { const value = records.get(id); return value ? { type: value.type, configured: true } : { configured: false }; }
export function credentialStore(routeId) {
  const exclusive = task => { const operation = (chains.get(routeId) || Promise.resolve()).then(task); chains.set(routeId, operation.catch(() => {})); return operation; };
  return {
    read: async () => structuredClone(records.get(routeId)),
    list: async () => records.has(routeId) ? [{ providerId: routeId, type: records.get(routeId).type }] : [],
    modify: (_id, fn, options) => exclusive(async () => { options?.signal?.throwIfAborted(); const previous = JSON.stringify(records.get(routeId)); const next = await fn(structuredClone(records.get(routeId))); options?.signal?.throwIfAborted(); if (JSON.stringify(records.get(routeId)) !== previous) throw Error('认证信息已在请求期间变化，请重试'); if (next !== undefined) {
      if (!persist) throw Error('原生凭据存储尚未连接，无法保存登录或刷新结果');
      await persist('prov.' + routeId, JSON.stringify(next)); records.set(routeId, structuredClone(next));
    } return structuredClone(records.get(routeId)); }),
    delete: (_id, options) => exclusive(async () => { options?.signal?.throwIfAborted(); if (!persist) throw Error('原生凭据存储尚未连接'); await persist('prov.' + routeId, ''); records.delete(routeId); }),
  };
}
const authContext = { env: async name => process.env[name], fileExists: async file => { try { await fs.access(file.startsWith('~/') ? path.join(os.homedir(), file.slice(2)) : file); return true; } catch { return false; } } };
export function catalogEntries() {
  return [...providers.values()].map(provider => ({ id: provider.id, name: provider.name, baseUrl: provider.baseUrl || '', methods: [
    ...(provider.auth.oauth && provider.id !== 'openai' ? [{ id: 'oauth', label: provider.auth.oauth.loginLabel || provider.auth.oauth.name }] : []),
    ...(provider.auth.apiKey?.login ? [{ id: 'api_key', label: provider.auth.apiKey.name }] : []),
  ], models: provider.getModels().map(model => ({ id: model.id, name: model.name, api: model.api, contextWindow: model.contextWindow, maxTokens: model.maxTokens, vision: model.input.includes('image'), compat: model.compat,
    thinking: { levels: model.reasoning ? ALL_LEVELS.filter(level => model.thinkingLevelMap?.[level] !== null && (!['xhigh','max'].includes(level) || model.thinkingLevelMap?.[level] !== undefined)) : ['off'], transport: 'effort', wireValues: model.thinkingLevelMap || {} } })) }));
}
export function catalogRoute(cfg) {
  const base = providers.get(cfg.catalogProviderId); if (!base) throw Error('内置供应商不存在，请重新选择');
  const available = base.getModels(), known = available.find(model => model.id === cfg.model), apis = [...new Set(available.map(model => model.api))];
  if (!known && !cfg.api && apis.length !== 1) throw Error('未列出的模型需要明确接口；请使用自定义渠道，或从供应商目录选择模型');
  const original = known || { id: cfg.model, name: cfg.model, api: cfg.api || apis[0], provider: base.id, baseUrl: base.baseUrl || '', input: cfg.vision ? ['text','image'] : ['text'], reasoning: (cfg.thinkingLevels || []).some(level=>level!=='off'), contextWindow: cfg.contextWindow || 128000, maxTokens: cfg.maxTokens || 4096, cost: {input:0,output:0,cacheRead:0,cacheWrite:0}, thinkingLevelMap: cfg.thinking?.wireValues };
  const model = { ...original, provider: cfg.providerId, ...(cfg.baseUrl ? { baseUrl: cfg.baseUrl } : {}), ...(cfg.contextWindow ? { contextWindow: cfg.contextWindow } : {}), ...(cfg.maxTokens ? { maxTokens: cfg.maxTokens } : {}), ...(cfg.compat ? { compat: { ...original.compat, ...cfg.compat } } : {}) };
  const models = builtinModels({ credentials: credentialStore(cfg.providerId), authContext }); models.clearProviders();
  const auth = cfg.apiKey && !base.auth.apiKey ? { ...base.auth, apiKey: { name: 'Configured API key', resolve: async ({ credential }) => ({ auth: credential?.key ? { apiKey: credential.key } : {} }) } } : base.auth;
  models.setProvider({ id: cfg.providerId, name: base.name, auth, getModels: () => [model], stream: (model, context, options) => base.stream(model, context, options), streamSimple: (model, context, options) => base.streamSimple(model, context, options) });
  return { model, models };
}
export function catalogLogin(routeId, catalogId, method, interaction) {
  const provider = providers.get(catalogId); if (!provider || !catalogEntries().find(value => value.id === catalogId)?.methods.some(value => value.id === method)) throw Error('此供应商不支持所选登录方式');
  const models = builtinModels({ credentials: credentialStore(routeId), authContext }); models.clearProviders(); models.setProvider({ ...provider, id: routeId });
  return models.login(routeId, method, interaction);
}
