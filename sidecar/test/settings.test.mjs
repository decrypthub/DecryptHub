// settings：BOM 容错、迁移、嵌入模式判定。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wdh-set-'));

test('old implicit forty-step limit migrates; every stored kernel is forced to CloakBrowser', async () => {
  const root = tmp(), directory = path.join(root, 'WebDecryptHub'); fs.mkdirSync(directory);
  for (const [raw, expected] of [[{ maxSteps: 40, kernel: 'cloak' }, 0], [{ maxSteps: 40, runLimitsVersion: 1, kernel: 'github' }, 40], [{ maxSteps: 120, kernel: 'custom', chromePath: '/opt/chromium' }, 120]]) {
    fs.writeFileSync(path.join(directory, 'settings.json'), JSON.stringify(raw));
    await withAppData(root, mod => {
      const loaded = mod.load();
      assert.equal(loaded.maxSteps, expected);
      assert.equal(loaded.kernel, 'cloak');
      assert.equal(loaded.chromePath, '');
      assert.equal(loaded.runLimitsVersion, 1);
    });
  }
});

test('save() keeps CloakBrowser even when a caller passes another kernel', async () => {
  const root = tmp();
  await withAppData(root, mod => {
    const settings = mod.load();
    settings.kernel = 'system'; settings.chromePath = '/usr/bin/google-chrome';
    mod.save(settings);
    const written = JSON.parse(fs.readFileSync(path.join(root, 'WebDecryptHub', 'settings.json'), 'utf8'));
    assert.equal(written.kernel, 'cloak');
    assert.equal(written.chromePath, '');
  });
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

test('browserPresentation: macOS 默认串流；停靠模式有头且不串流', async () => {
  const mod = await import('../settings.mjs');
  assert.deepEqual(mod.browserPresentation({ headless: false, embedMode: 'auto' }, 'darwin', {}), { embed: false, headless: true, dock: false });
  assert.deepEqual(mod.browserPresentation({ headless: false, embedMode: 'docked' }, 'darwin', {}), { embed: false, headless: false, dock: true });
  assert.deepEqual(mod.browserPresentation({ headless: true, embedMode: 'docked' }, 'darwin', {}), { embed: false, headless: true, dock: false });
  assert.deepEqual(mod.browserPresentation({ headless: false, embedMode: 'docked' }, 'win32', {}), { embed: true, headless: false, dock: false });
});

/** 清掉 DECRYPTHUB_DATA_DIR，让 userDataDir() 走真实的 APPDATA 分支 */
async function withBase(fn) {
  const prev = { data: process.env.DECRYPTHUB_DATA_DIR, appdata: process.env.APPDATA, xdg: process.env.XDG_CONFIG_HOME };
  delete process.env.DECRYPTHUB_DATA_DIR;
  try { return await fn(); } finally {
    for (const [k, v] of [['DECRYPTHUB_DATA_DIR', prev.data], ['APPDATA', prev.appdata], ['XDG_CONFIG_HOME', prev.xdg]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

test('默认数据目录用产品名 DecryptHub，不再叫 WebDecryptHub', async () => {
  const base = tmp();
  process.env.APPDATA = base; process.env.XDG_CONFIG_HOME = base;
  await withBase(async () => {
    const mod = await import(`../settings.mjs?n=${Date.now()}${Math.random()}`);
    assert.equal(mod.DATA_DIR_NAME, 'DecryptHub');
    const dir = mod.userDataDir();
    assert.equal(path.basename(dir), 'DecryptHub');
    assert.equal(fs.existsSync(dir), true);
  });
});

test('旧 WebDecryptHub 数据目录会被整体迁移到 DecryptHub（设置与会话都不丢）', async () => {
  const base = tmp();
  process.env.APPDATA = base; process.env.XDG_CONFIG_HOME = base;
  const legacy = path.join(base, 'WebDecryptHub');
  fs.mkdirSync(path.join(legacy, 'projects', 'main'), { recursive: true });
  fs.writeFileSync(path.join(legacy, 'settings.json'), JSON.stringify({ headless: true, openai: { model: 'kept-model' } }));
  fs.writeFileSync(path.join(legacy, 'sessions.json'), JSON.stringify({ focused: 'main', sessions: [{ id: 'main', primary: true }] }));
  fs.writeFileSync(path.join(legacy, 'projects', 'main', '.agent-history.json'), '{"events":[]}');
  await withBase(async () => {
    const mod = await import(`../settings.mjs?n=${Date.now()}${Math.random()}`);
    const dir = mod.userDataDir();
    assert.equal(path.basename(dir), 'DecryptHub');
    // 数据跟着搬过去，不是新建空目录
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')).openai.model, 'kept-model');
    assert.equal(fs.existsSync(path.join(dir, 'sessions.json')), true);
    assert.equal(fs.existsSync(path.join(dir, 'projects', 'main', '.agent-history.json')), true);
    assert.equal(fs.existsSync(legacy), false, '旧目录必须整体改名，不能留在原地');
    assert.equal(mod.load().headless, true);
  });
});

test('DecryptHub 已存在时不会被旧的 WebDecryptHub 覆盖', async () => {
  const base = tmp();
  process.env.APPDATA = base; process.env.XDG_CONFIG_HOME = base;
  const current = path.join(base, 'DecryptHub');
  fs.mkdirSync(current, { recursive: true });
  fs.writeFileSync(path.join(current, 'settings.json'), JSON.stringify({ openai: { model: 'new-model' } }));
  const legacy = path.join(base, 'WebDecryptHub');
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, 'settings.json'), JSON.stringify({ openai: { model: 'stale-model' } }));
  await withBase(async () => {
    const mod = await import(`../settings.mjs?n=${Date.now()}${Math.random()}`);
    const dir = mod.userDataDir();
    assert.equal(path.basename(dir), 'DecryptHub');
    assert.equal(mod.load().openai.model, 'new-model', '已有新目录时旧目录只能当遗留，不能顶掉它');
    assert.equal(fs.existsSync(legacy), true, '旧目录保持原样，等用户自己决定');
  });
});

test('更早的 JSReverseAgent 目录也能一路迁移到 DecryptHub', async () => {
  const base = tmp();
  process.env.APPDATA = base; process.env.XDG_CONFIG_HOME = base;
  const ancient = path.join(base, 'JSReverseAgent');
  fs.mkdirSync(ancient, { recursive: true });
  fs.writeFileSync(path.join(ancient, 'settings.json'), JSON.stringify({ openai: { model: 'ancient-model' } }));
  await withBase(async () => {
    const mod = await import(`../settings.mjs?n=${Date.now()}${Math.random()}`);
    const dir = mod.userDataDir();
    assert.equal(path.basename(dir), 'DecryptHub');
    assert.equal(mod.load().openai.model, 'ancient-model');
    assert.equal(fs.existsSync(ancient), false);
  });
});

