import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { publicSettings, decryptSecrets, mirrorProvider } from '../secrets.mjs';
test('public settings reveal configuration status without returning stored model keys', () => {
  const settings = { openai: { apiKey: 'fixture-private-key' }, anthropic: { apiKey: '' }, providers: [{ id: 'p', apiKey: 'fixture-provider-key' }] };
  const publicValue = publicSettings(settings);
  assert.equal(publicValue.openai.hasKey, true); assert.equal(publicValue.providers[0].hasKey, true);
  assert.ok(!JSON.stringify(publicValue).includes('fixture-')); assert.equal(settings.openai.apiKey, 'fixture-private-key');
});
test('native encrypted envelopes authenticate both the key and the ciphertext', () => {
  const key = crypto.randomBytes(32), nonce = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ 'prov.p': 'fixture-key' })), cipher.final(), cipher.getAuthTag()]);
  const envelope = { nonce: nonce.toString('hex'), ciphertext: ciphertext.toString('hex') };
  assert.deepEqual(decryptSecrets(key, envelope), { 'prov.p': 'fixture-key' });
  assert.throws(() => decryptSecrets(crypto.randomBytes(32), envelope));
  const tampered = Buffer.from(ciphertext); tampered[0] ^= 1;
  assert.throws(() => decryptSecrets(key, { ...envelope, ciphertext: tampered.toString('hex') }));
});
test('switching providers selects that provider credential and model metadata', () => {
  const settings = { provider: 'openai', openai: { apiKey: 'old' }, activeProviderId: 'new', activeModel: 'model', providers: [{ id: 'new', type: 'openai', baseUrl: 'https://example.invalid', apiKey: 'new-key', models: [{ id: 'model', contextWindow: 99999, vision: true }] }] };
  mirrorProvider(settings); assert.equal(settings.openai.apiKey, 'new-key'); assert.equal(settings.openai.model, 'model'); assert.equal(settings.openai.contextWindow, 99999);
});
