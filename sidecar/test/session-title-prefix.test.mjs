// 会话标题前缀：纯展示层配置。本文件锁住三件事：
// 1) 拼接规则本身（含分隔符与截断）；
// 2) 前缀**绝不进入**持久化的 title —— 否则 sessions.mjs 的 titleSource 判定会失配，
//    自动标题从此静默失效（见 sessions.mjs 的 /^(?:会话\s*\d+|新对话|新会话)$/）；
// 3) settings.json 三段式（DEFAULTS / load 归一 / save 持久化）对 titlePrefix 都成立。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeTitlePrefix, sessionDisplayTitle, generateSessionTitle, SessionTitleService, TITLE_PREFIX_MAX } from '../session-titles.mjs';
import { TestSessionManager as SessionManager } from './project-fixture.mjs';
import { sessionLabel, sessionTitle } from '../../ui/src/state.js';

const settings = { provider: 'openai', openai: { baseUrl: 'https://model.invalid/v1', model: 'fixture', apiKey: 'fixture-key' } };
function manager(t, generator, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wdh-prefix-'));
  const mgr = new SessionManager({ userDataDir: directory, getSettings: () => ({ ...settings, ...overrides }), broadcast() {}, chromeMod: {}, titleGenerator: generator });
  t.after(async () => { await mgr.closeAll(); fs.rmSync(directory, { recursive: true, force: true }); }); return mgr;
}
const savedTitles = file => JSON.parse(fs.readFileSync(file, 'utf8')).sessions.map(s => ({ title: s.title, titleSource: s.titleSource }));

test('prefix formatting is display-only: separator handling, empty cases and codepoint truncation', () => {
  assert.equal(sessionDisplayTitle('检查登录签名', '[分析]'), '[分析] 检查登录签名');
  // 已自带分隔符的前缀不再补空格，避免「[分析]  标题」这类双空格
  assert.equal(sessionDisplayTitle('检查登录签名', '[分析] '), '[分析] 检查登录签名');
  assert.equal(sessionDisplayTitle('检查登录签名', '分析:'), '分析:检查登录签名');
  assert.equal(sessionDisplayTitle('检查登录签名', '分析：'), '分析：检查登录签名');
  assert.equal(sessionDisplayTitle('检查登录签名', '分析 -'), '分析 - 检查登录签名');
  // 未配置前缀时展示名与存储名完全一致，这是旧用户零感知升级的前提
  assert.equal(sessionDisplayTitle('检查登录签名', ''), '检查登录签名');
  assert.equal(sessionDisplayTitle('检查登录签名', undefined), '检查登录签名');
  assert.equal(sessionDisplayTitle('', '[分析]'), '[分析] 对话');
  assert.equal(sessionDisplayTitle(undefined, '[分析]'), '[分析] 对话');
  assert.equal(sessionDisplayTitle(null, ''), '对话');

  assert.equal(normalizeTitlePrefix('  [分析]  '), '[分析]');
  assert.equal(normalizeTitlePrefix('分析\t\n前缀'), '分析 前缀');
  assert.equal(normalizeTitlePrefix('a\u0000b\u001fc'), 'a b c');
  assert.equal(normalizeTitlePrefix(undefined), '');
  assert.equal(normalizeTitlePrefix(null), '');
  assert.equal(normalizeTitlePrefix(42), '');
  assert.equal(normalizeTitlePrefix({}), '');
  // 按码点截断：emoji 是代理对，不能被切成半个字符
  assert.equal(Array.from(normalizeTitlePrefix('一'.repeat(TITLE_PREFIX_MAX + 5))).length, TITLE_PREFIX_MAX);
  assert.equal(normalizeTitlePrefix('😀'.repeat(TITLE_PREFIX_MAX + 3)), '😀'.repeat(TITLE_PREFIX_MAX));
});

test('configured prefix never leaks into the stored title or flips titleSource to manual', async t => {
  const mgr = manager(t, async () => '定位登录请求签名', { titlePrefix: '[分析]' }), s = mgr.focused();
  // 占位会话：title 原文必须保持「会话 N」，否则下面这行会变成 'manual'
  assert.equal(s.title, '会话 1');
  assert.equal(s.titleSource, 'placeholder');
  assert.equal(sessionLabel(s, '[分析]'), '[分析] 会话 1');

  await s.suggestTitle('分析 https://example.com 的登录签名');
  assert.equal(s.titleSource, 'model');
  assert.equal(s.title, '定位登录请求签名');
  assert.ok(!s.title.includes('[分析]'));

  // 落盘的 sessions.json 只有干净标题：旧数据不需要迁移，也不需要认识前缀
  assert.deepEqual(savedTitles(mgr.stateFile), [{ title: '定位登录请求签名', titleSource: 'model' }]);

  // 恢复后 titleSource 语义照旧：model 不会被重新判成 placeholder 或 manual
  const restored = new SessionManager({ userDataDir: mgr.userDataDir, getSettings: () => ({ ...settings, titlePrefix: '[分析]' }), broadcast() {}, chromeMod: {}, titleGenerator: () => { throw Error('must not regenerate'); } });
  t.after(() => restored.closeAll());
  assert.equal(restored.focused().title, '定位登录请求签名');
  assert.equal(restored.focused().titleSource, 'model');
});

test('a prefixed placeholder still gets an automatic title, i.e. display prefix does not gate suggestion', async t => {
  // 这条是 titleSource 失配的直接回归：如果前缀被写进 title，「会话 1」会失配成 manual，
  // suggestTitle 会在第一行直接 return，自动标题永远不再发生。
  let calls = 0;
  const mgr = manager(t, async () => { calls++; return '自动生成的标题'; }, { titlePrefix: '[审计]' }), s = mgr.focused();
  assert.equal(sessionLabel(s, '[审计]'), '[审计] 会话 1');
  await s.suggestTitle('审计一下这个接口的鉴权');
  assert.equal(calls, 1);
  assert.equal(s.title, '自动生成的标题');
  assert.equal(s.titleSource, 'model');
  assert.equal(sessionLabel(s, '[审计]'), '[审计] 自动生成的标题');
});

test('renaming repeatedly prefills and saves the clean title, so the prefix cannot accumulate', async t => {
  const mgr = manager(t, async () => '模型给的标题', { titlePrefix: '[分析]' }), s = mgr.focused();
  // 对话框预填值来自 sessionTitle（存储值），不是 sessionLabel（展示值）
  let field = sessionTitle(s);
  assert.equal(field, '会话 1');
  assert.ok(!field.includes('[分析]'));
  for (let i = 0; i < 3; i++) {
    s.rename(field);
    assert.equal(s.title, '会话 1');
    assert.equal(s.titleSource, 'manual');
    assert.equal(sessionLabel(s, '[分析]'), '[分析] 会话 1');
    field = sessionTitle(s); // 再打开一次对话框
  }
  assert.deepEqual(savedTitles(mgr.stateFile), [{ title: '会话 1', titleSource: 'manual' }]);

  // 带分隔符的前缀同样不会把展示名带回存储
  s.rename('我的登录分析');
  assert.equal(sessionTitle(s), '我的登录分析');
  assert.equal(sessionLabel(s, '分析：'), '分析：我的登录分析');
  s.rename(sessionTitle(s));
  assert.equal(s.title, '我的登录分析');
});

test('a manually typed prefix is stored verbatim and still blocks the model title', async t => {
  const mgr = manager(t, async () => '模型标题', { titlePrefix: '[分析]' }), s = mgr.focused();
  // 用户手打的「[分析]」是普通标题文字：原样存储，展示层不做去重
  // （去重会在「标题本来就以前缀开头」时悄悄吞字，代价大于收益）。
  s.rename('[分析] 手动标题');
  assert.equal(s.title, '[分析] 手动标题');
  assert.equal(s.titleSource, 'manual');
  assert.equal(sessionLabel(s, '[分析]'), '[分析] [分析] 手动标题');
  // 手动标题不会被自动标题覆盖，这一点与是否配置前缀无关
  await s.suggestTitle('新的任务描述');
  assert.equal(s.title, '[分析] 手动标题');
  assert.equal(s.titleSource, 'manual');
});

test('sidebar search matches both the clean title and the prefixed display name', async () => {
  const { sidebarResults } = await import('../../ui/src/sidebar-model.js');
  const projects = [{ id: 'a', name: '目标站', folders: [{ root: '/code/alpha' }] }];
  const sessions = [{ id: 's', projectId: 'a', title: '登录签名分析', updatedAt: 1 }];
  assert.deepEqual(sidebarResults(projects, sessions, '登录签名').map(r => r.key), ['s:s']);
  assert.deepEqual(sidebarResults(projects, sessions, '分析', [], '[分析]').map(r => r.key), ['s:s']);
  // 搜索结果标题是展示名，但底层 title 没被改写
  assert.equal(sidebarResults(projects, sessions, '登录', [], '[分析]')[0].title, '[分析] 登录签名分析');
  assert.equal(sessions[0].title, '登录签名分析');
});

test('title generation still reaches the model through the injected entry point', async () => {
  // session-titles.mjs 对 UI 保持零 Node 依赖，模型入口由组装点注入；
  // 这条测试锁住「注入没接上就报清楚错误」而不是静默拿到 undefined 标题。
  await assert.rejects(generateSessionTitle(settings, '任务'), /需要注入 complete/);
  const service = new SessionTitleService({ complete: async () => ({ content: '注入入口生成的标题' }) });
  assert.equal(await service.generate(settings, '分析登录接口'), '注入入口生成的标题');
});

test('settings.json round-trips titlePrefix through DEFAULTS, load normalization and save', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdh-prefix-set-'));
  const previous = process.env.DECRYPTHUB_DATA_DIR;
  // 每次换一个 query 拿到新模块实例；DECRYPTHUB_DATA_DIR 已指向临时目录，绝不碰真实用户配置
  const load = () => import(`../settings.mjs?t=${Date.now()}${Math.random()}`);
  const write = value => fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(value));
  process.env.DECRYPTHUB_DATA_DIR = dir;
  try {
    const fresh = await load();
    assert.equal(fresh.DEFAULTS.titlePrefix, '');
    // 没有 settings.json 时默认不显示前缀
    assert.equal(fresh.load().titlePrefix, '');

    // load()：脏值被归一，而不是整段丢弃
    write({ titlePrefix: '  [分析]\n前缀  ' });
    assert.equal((await load()).load().titlePrefix, '[分析] 前缀');
    write({ titlePrefix: '一'.repeat(40) });
    assert.equal(Array.from((await load()).load().titlePrefix).length, TITLE_PREFIX_MAX);
    write({ titlePrefix: { bad: true } });
    assert.equal((await load()).load().titlePrefix, '');

    // save()：落盘前再归一一次，然后能被 load() 原样读回
    const mod = await load();
    const value = mod.load();
    value.titlePrefix = '  [审计]  ';
    mod.save(value);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')).titlePrefix, '[审计]');
    assert.equal(mod.load().titlePrefix, '[审计]');

    // 空串同样要能写回（用户清空前缀），不能被「falsy 即默认」吃掉
    const cleared = mod.load(); cleared.titlePrefix = '';
    mod.save(cleared);
    assert.equal(mod.load().titlePrefix, '');
  } finally {
    if (previous === undefined) delete process.env.DECRYPTHUB_DATA_DIR; else process.env.DECRYPTHUB_DATA_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
