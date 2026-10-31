import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('onboarding preferences survive a settings save/load round trip', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-settings-'));
  process.env.DECRYPTHUB_DATA_DIR = dir;
  const { save, load } = await import('../settings.mjs');
  const { publicSettings } = await import('../secrets.mjs');
  try {
    const settings = load();
    settings.onboarding = { version: 1, completedAt: '2026-10-31T00:00:00.000Z', domains: ['web', 'ios'], level: 'advanced' };
    save(settings);
    const again = load();
    assert.deepEqual(again.onboarding, settings.onboarding);
    const exposed = publicSettings(again);
    assert.deepEqual(exposed.onboarding.domains, ['web', 'ios']);
    assert.equal(exposed.openai.apiKey, '');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
