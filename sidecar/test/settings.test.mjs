// settings：BOM 容错、迁移、嵌入模式判定。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wdh-set-'));

test('old implicit forty-step limit migrates; explicit budgets and installed kernel selection survive restart', async () => {
  const root = tmp(), directory = path.join(root, 'WebDecryptHub'); fs.mkdirSync(directory);
  for (const [raw, expected] of [[{ maxSteps: 40, kernel: 'cloak' }, 0], [{ maxSteps: 40, runLimitsVersion: 1, kernel: 'github' }, 40], [{ maxSteps: 120, kernel: 'custom' }, 120]]) {
    fs.writeFileSync(path.join(directory, 'settings.json'), JSON.stringify(raw));
    await withAppData(root, mod => { const loaded = mod.load(); assert.equal(loaded.maxSteps, expected); assert.equal(loaded.kernel, raw.kernel); assert.equal(loaded.runLimitsVersion, 1); });
  }
});

/** 在临时 APPDATA 下调用一次 load()，避免碰真实用户目录 */
async function withAppData(dir, fn) {
  const prev = process.env.DECRYPTHUB_DATA_DIR;
  process.env.DECRYPTHUB_DATA_DIR = path.join(dir, 'WebDecryptHub');
  const mod = await import(`../settings.mjs?t=${Date.now()}${Math.random()}`);
  try { return await fn(mod); } finally { if (prev === undefined) delete process.env.DECRYPTHUB_DATA_DIR; else process.env.DECRYPTHUB_DATA_DIR = prev; }
}

test('settings: 带 BOM 的 settings.json 也能读（否则会静默回到默认值）', async () => {
  const appdata = tmp();
  const dir = path.join(appdata, 'WebDecryptHub');
  fs.mkdirSync(dir, { recursive: true });
  const body = JSON.stringify({ headless: true, embedMode: 'screencast', openai: { model: 'demo-model' } });
  fs.writeFileSync(path.join(dir, 'settings.json'), '\uFEFF' + body);
  await withAppData(appdata, mod => {
    const s = mod.load();
    assert.equal(s.headless, true);
    assert.equal(s.embedMode, 'screencast');
    assert.equal(s.openai.model, 'demo-model');
  });
});

test('settings: 损坏的 json 仍然安全回落默认值', async () => {
  const appdata = tmp();
  const dir = path.join(appdata, 'WebDecryptHub');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), '{不是 json');
  await withAppData(appdata, mod => {
    const s = mod.load();
    assert.equal(s.provider, 'openai');
    assert.equal(s.openai.model, 'gpt-4o');
  });
});

test('settings: 密钥不落盘', async () => {
  const appdata = tmp();
  await withAppData(appdata, mod => {
    mod.save({ provider: 'openai', openai: { apiKey: 'sk-secret', baseUrl: 'x', model: 'm' }, anthropic: { apiKey: 'ck', baseUrl: 'y', model: 'n' } });
    const onDisk = fs.readFileSync(path.join(appdata, 'WebDecryptHub', 'settings.json'), 'utf8');
    assert.equal(onDisk.includes('sk-secret'), false);
    assert.equal(onDisk.includes('"ck"'), false);
  });
});

test('wantEmbed: 有头 + Windows 才内嵌；Wayland/Linux 需要 DISPLAY', async () => {
  const mod = await import('../settings.mjs');
  assert.equal(mod.wantEmbed({ headless: false }, 'win32', {}), true);
  assert.equal(mod.wantEmbed({ headless: true }, 'win32', {}), false);
  assert.equal(mod.wantEmbed({ headless: false, embedMode: 'screencast' }, 'win32', {}), false);
  assert.equal(mod.wantEmbed({ headless: false, embedMode: 'embedded' }, 'linux', { DISPLAY: ':0' }), true);
  assert.equal(mod.wantEmbed({ headless: false }, 'linux', {}), false);
  assert.equal(mod.wantEmbed({ headless: false }, 'darwin', {}), false);
});
