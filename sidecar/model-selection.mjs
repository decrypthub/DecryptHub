// Shared pure selection projection. Credentials stay in the provider catalog;
// each Session owns only provider/model/effort identities, as DSH does.
import { normalizeThinking, modelThinking, isThinkingLevel } from './thinking.mjs';
export function captureSelection(settings) {
  return { providerId: settings.activeProviderId || null,
    model: typeof settings.activeModel === 'object' ? settings.activeModel?.id : settings.activeModel || settings[settings.provider]?.model || '',
    thinking: settings.activeThinking || '', ...(!settings.activeProviderId ? { providerType: settings.provider === 'anthropic' ? 'anthropic' : 'openai' } : {}) };
}
export function selectionSettings(settings, selection) {
  if (!selection?.providerId) {
    const type = selection?.providerType || (settings.provider === 'anthropic' ? 'anthropic' : 'openai');
    return { ...settings, provider: type, activeModel: selection?.model || settings[type]?.model,
      [type]: { ...settings[type], model: selection?.model || settings[type]?.model }, activeThinking: selection?.thinking ?? settings.activeThinking };
  }
  const provider = (settings.providers || []).find(p => p.id === selection.providerId);
  const entry = provider?.models?.find(m => (typeof m === 'string' ? m : m.id) === selection.model);
  if (!provider || !entry) return { ...settings, activeProviderId: selection.providerId, activeModel: selection.model, activeThinking: selection.thinking,
    openai: { ...settings.openai, apiKey: '' }, anthropic: { ...settings.anthropic, apiKey: '' }, selectionError: '本聊天选择的供应商或模型已被移除，请重新选择模型' };
  const type = provider.type;
  const config = { ...settings[type], apiKey: provider.apiKey || '', baseUrl: provider.baseUrl, model: selection.model,
    contextWindow: Number(entry.contextWindow) || Number(provider.contextWindow) || 0, vision: !!entry.vision,
    maxTokens: Number(entry.maxTokens) || Number(provider.maxTokens) || undefined };
  config.api = entry.api || provider.api || null;
  config.catalogProviderId = provider.catalogId || null;
  config.compat = { ...provider.compat, ...entry.compat };
  config.thinkingLevels = typeof entry === 'object' ? entry.thinking?.levels : [];
  if (typeof entry === 'object' && entry.thinking) config.thinking = normalizeThinking(entry.thinking, type === 'anthropic' ? 'budget' : 'effort');
  else delete config.thinking;
  return { ...settings, provider: type, activeProviderId: provider.id, activeModel: selection.model, activeThinking: selection.thinking || '', [type]: config };
}
export function updateSelection(settings, previous, input) {
  const providerId = input.providerId ?? previous.providerId;
  const model = typeof input.model === 'object' ? input.model.id : input.model ?? previous.model;
  const provider = (settings.providers || []).find(p => p.id === providerId);
  const entry = provider?.models?.find(m => (typeof m === 'string' ? m : m.id) === model);
  if (!provider || !entry) throw Error('供应商或模型不存在，请重新选择');
  const changed = previous.providerId !== providerId || previous.model !== model;
  const thinking = input.thinking ?? (changed ? '' : previous.thinking);
  if (thinking && (!isThinkingLevel(thinking) || !modelThinking(typeof entry === 'object' ? entry.thinking : null, model).levels.includes(thinking)))
    throw Error('当前模型不支持所选思考强度');
  return { providerId, model, thinking: thinking || '' };
}
