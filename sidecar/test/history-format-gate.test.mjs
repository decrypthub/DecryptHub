// 会话事件版本门：参考 DSH `session-persistence/storage-contract.ts`。
// 核心不变量：**不认识的事件类型不能静默跳过** —— 跳过一条必要事件可能
// 重建出错误的会话，用户看到的历史被悄悄改了却没有任何提示。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { History, HISTORY_VERSION, KNOWN_EVENT_TYPES, HistoryFormatError } from '../history.mjs';

function tmpFile(t, data) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-hist-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, '.agent-history.json');
  fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data));
  return file;
}

test('白名单覆盖真实数据里出现过的事件类型', () => {
  // 这几种在当前线上数据里都实际存在（2026-11-02 扫描 14 个会话 / 3513 事件）
  for (const type of ['user', 'assistant', 'tool', 'continuation', 'turn-end']) {
    assert.ok(KNOWN_EVENT_TYPES.has(type), `缺少真实存在的事件类型: ${type}`);
  }
  // summary 由压缩流程写入
  assert.ok(KNOWN_EVENT_TYPES.has('summary'));
});

test('正常版本的历史照常加载', t => {
  const file = tmpFile(t, { v: HISTORY_VERSION, events: [
    { t: 'user', content: 'hi' },
    { t: 'assistant', content: 'hello' },
    { t: 'tool', content: 'ok' },
    { t: 'turn-end' },
  ] });
  const h = History.load(file, '');
  assert.equal(h.events.length, 4);
});

test('更高版本的文件拒绝加载，而不是当成空对话', t => {
  this && t;
  const file = tmpFile(t, { v: HISTORY_VERSION + 1, events: [{ t: 'user', content: 'hi' }] });
  assert.throws(
    () => History.load(file, ''),
    err => {
      assert.ok(err instanceof HistoryFormatError);
      assert.equal(err.code, 'history-format-unsupported');
      assert.match(err.message, /版本/);
      assert.match(err.message, /已拒绝加载/);
      // 必须说清出路，否则用户只能干着急
      assert.match(err.message, /升级应用|备份/);
      return true;
    },
  );
});

test('未知事件类型且未标记可忽略 → 拒绝加载', t => {
  const file = tmpFile(t, { v: HISTORY_VERSION, events: [
    { t: 'user', content: 'hi' },
    { t: 'brand-new-event-from-future', seq: 7 },
  ] });
  assert.throws(
    () => History.load(file, ''),
    err => {
      assert.ok(err instanceof HistoryFormatError);
      assert.match(err.message, /不认识的事件类型/);
      assert.match(err.message, /brand-new-event-from-future/);
      assert.match(err.message, /错误重建|拒绝加载/);
      return true;
    },
  );
});

test('未知事件类型但显式 ignorable:true → 允许跳过', t => {
  const file = tmpFile(t, { v: HISTORY_VERSION, events: [
    { t: 'user', content: 'hi' },
    { t: 'future-telemetry', ignorable: true },
    { t: 'assistant', content: 'ok' },
  ] });
  const h = History.load(file, '');
  assert.equal(h.events.length, 2, '可忽略的事件应当被跳过，其余保留');
  assert.equal(h.events[1].t, 'assistant');
});

test('文件不存在或 JSON 语法坏 → 静默回落空历史（不算版本问题）', t => {
  const missing = path.join(os.tmpdir(), 'dh-hist-does-not-exist-' + Date.now() + '.json');
  assert.equal(History.load(missing, '').events.length, 0);

  const broken = tmpFile(t, '{不是合法 json');
  assert.equal(History.load(broken, '').events.length, 0, '语法错误是损坏，按空历史处理');
});

test('v1 裸数组仍走迁移路径，不被版本门拦', t => {
  const file = tmpFile(t, [
    { role: 'user', content: '老格式' },
    { role: 'assistant', content: '收到' },
  ]);
  const h = History.load(file, '');
  assert.equal(h.events.length, 2);
  assert.equal(h.events[0].t, 'user');
});

test('缺少 v 字段的旧文件不因版本门失败', t => {
  const file = tmpFile(t, { events: [{ t: 'user', content: 'no version field' }] });
  const h = History.load(file, '');
  assert.equal(h.events.length, 1);
});
