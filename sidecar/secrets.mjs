import crypto from 'node:crypto';
export function publicSettings(settings) {
  const out = JSON.parse(JSON.stringify(settings));
  for (const type of ['openai', 'anthropic']) if (out[type]) { out[type].hasKey = !!out[type].apiKey; out[type].apiKey = ''; }
  out.providers = (out.providers || []).map(p => ({ ...p, apiKey: '', hasKey: !!p.apiKey }));
  return out;
}
export function decryptSecrets(key, envelope) {
  if (!key || !envelope || !/^[a-f0-9]{24}$/i.test(envelope.nonce || '') || !/^[a-f0-9]{32,131072}$/i.test(envelope.ciphertext || '')) throw new Error('无效的原生凭据同步请求');
  const encrypted = Buffer.from(envelope.ciphertext, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.nonce, 'hex'));
  decipher.setAuthTag(encrypted.subarray(-16));
  return JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]).toString('utf8'));
}
export function mirrorProvider(settings) {
  const p = settings.providers?.find(x => x.id === settings.activeProviderId);
  if (!p) return;
  const id = typeof settings.activeModel === 'object' ? settings.activeModel.id : settings.activeModel;
  const model = p.models?.find(m => (typeof m === 'string' ? m : m.id) === id) || p.models?.[0];
  const selected = (typeof model === 'string' ? model : model?.id) || id || '';
  settings.activeModel = selected;
  settings.provider = p.type;
  settings[p.type] = { ...settings[p.type], baseUrl: p.baseUrl, model: selected, apiKey: p.apiKey || '', contextWindow: Number(model?.contextWindow) || Number(p.contextWindow) || 0, vision: !!model?.vision };
}
