// 事件化历史：append-only 不变式、派生视图、视图期裁剪、检查点语义、持久化与 v1 迁移。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { History, migrateV1, HISTORY_VERSION } from '../history.mjs';
import { SUMMARY_PREFIX } from '../context.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wdh-hist-'));

function sample() {
  const h = new History({ system: 'SYS' });
  h.append({ t: 'user', content: 'u1' });
  h.append({ t: 'assistant', content: 'a1', calls: [{ id: 'c1', name: 'net_list', args: { hasSig: true } }] });
  h.append({ t: 'tool', id: 'c1', name: 'net_list', content: 'r1' });
  h.append({ t: 'assistant', content: 'a2' });
  return h;
}

test('view: system 开头，事件按 OpenAI 形状映射', () => {
  const h = sample();
  const v = h.view();
  assert.equal(v[0].role, 'system');
  assert.deepEqual(v.map(m => m.role), ['system', 'user', 'assistant', 'tool', 'assistant']);
  assert.equal(v[2].tool_calls[0].function.name, 'net_list');
  assert.equal(v[2].tool_calls[0].function.arguments, '{"hasSig":true}');
  assert.equal(v[3].tool_call_id, 'c1');
});

test('视图期裁剪：旧工具结果换成 ctx_ref，事件本身不被修改', () => {
  const dir = tmp();
  const h = new History({ system: 'SYS' });
  for (let i = 0; i < 5; i++) {
    h.append({ t: 'assistant', content: '', calls: [{ id: 'c' + i, name: 'net_get', args: {} }] });
    h.append({ t: 'tool', id: 'c' + i, name: 'net_get', content: ('x' + i).repeat(4500) });
  }
  const before = JSON.stringify(h.events);
  const v = h.view({ prune: { keep: 2, minChars: 1200, dir } });
  const toolMsgs = v.filter(m => m.role === 'tool');
  assert.equal(toolMsgs.length, 5);
  assert.match(toolMsgs[0].content, /ctx_[0-9a-f]{10}/);   // 最旧的三条被收起
  assert.ok(toolMsgs[0].content.length < 500);
  assert.equal(toolMsgs[4].content.length, 9000);          // 最近两条原样
  assert.equal(JSON.stringify(h.events), before);          // append-only：事件没变
  assert.equal(fs.readdirSync(dir).length, 3);             // 三份引用各落盘一次
  // 再算一次不会重复落盘（缓存）
  h.view({ prune: { keep: 2, minChars: 1200, dir } });
  assert.equal(fs.readdirSync(dir).length, 3);
});

test('相同内容只落盘一份', () => {
  const dir = tmp();
  const h = new History({ system: 'S' });
  for (let i = 0; i < 4; i++) { h.append({ t: 'assistant', content: '', calls: [{ id: 'c' + i, name: 'n', args: {} }] }); h.append({ t: 'tool', id: 'c' + i, name: 'n', content: 'z'.repeat(9000) }); }
  h.view({ prune: { keep: 1, minChars: 1200, dir } });
  assert.equal(fs.readdirSync(dir).length, 1);
});

test('检查点覆盖它之前的事件，视图从摘要之后继续', () => {
  const h = sample();
  const keep = JSON.stringify(h.events);
  h.commitSummary('## 目标\n- 复现 sign', { reason: 'manual', before: 100, after: 20 });
  h.append({ t: 'user', content: 'u2' });
  assert.equal(h.events.length, 6);                        // 只追加，不删除
  assert.equal(JSON.stringify(h.events.slice(0, 4)), keep);
  const v = h.view();
  assert.equal(v[0].role, 'system');
  assert.equal(v[1].role, 'user');
  assert.ok(v[1].content.startsWith(SUMMARY_PREFIX));
  assert.match(v[1].content, /复现 sign/);
  assert.equal(v[2].role, 'assistant');
  assert.equal(v[2]._ack, true);                           // 摘要后紧跟用户消息时补确认
  assert.deepEqual(v.slice(3).map(m => m.role), ['user']);
  assert.equal(v[3].content, 'u2');
  assert.equal(h.compressions, 1);
});

test('多轮压缩：最新摘要胜出，旧摘要留在日志里', () => {
  const h = sample();
  h.commitSummary('第一版', { reason: 'auto' });
  h.append({ t: 'user', content: 'u2' });
  h.commitSummary('第二版', { reason: 'auto' });
  const v = h.view();
  assert.match(v[1].content, /第二版/);
  assert.doesNotMatch(JSON.stringify(v), /第一版/);
  assert.equal(h.events.filter(e => e.t === 'summary').length, 2);
  assert.equal(h.compressions, 2);
});

test('plan: 切点不落在 tool 上，至少保留最后一条 user', () => {
  const h = new History({ system: 'S' });
  h.append({ t: 'user', content: 'u1' });
  h.append({ t: 'assistant', content: '', calls: [{ id: 'c1', name: 'n', args: {} }] });
  h.append({ t: 'tool', id: 'c1', name: 'n', content: 'r'.repeat(4000) });
  h.append({ t: 'assistant', content: 'a1' });
  h.append({ t: 'user', content: 'u2 ' + 'z'.repeat(4000) });
  const { cover, old, recent } = h.plan({ keepTokens: 50 });
  assert.ok(cover > 0 && cover < h.events.length);
  assert.notEqual(recent[0].t, 'tool');
  assert.equal(old.length + recent.length, h.events.length);
  // 手动压缩（keepTokens=0）也不能把最后一条 user 摘掉
  const all = h.plan({ keepTokens: 0 });
  assert.ok(all.recent.length >= 1);
  assert.ok(all.recent.some(e => e.t === 'user'));
});

test('plan: 已有检查点时只在摘要之后的事件里切', () => {
  const h = sample();
  h.commitSummary('ckpt');
  h.append({ t: 'user', content: 'u2' });
  const { old, recent } = h.plan({ keepTokens: 0 });
  assert.equal(old.length + recent.length, 1);              // 摘要前的 4 条不再参与
  assert.equal(recent[0].content, 'u2');
});

test('持久化往返 + 版本号', () => {
  const dir = tmp();
  const f = path.join(dir, '.agent-history.json');
  const h = sample();
  h.commitSummary('ckpt', { reason: 'auto' });
  assert.equal(h.save(f), true);
  const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.equal(raw.v, HISTORY_VERSION);
  const back = History.load(f, 'SYS');
  assert.deepEqual(back.events, h.events);
  assert.equal(back.view()[0].content, 'SYS');
  // 损坏文件不应抛错
  fs.writeFileSync(f, '{not json');
  assert.equal(History.load(f, 'S').events.length, 0);
});

test('v1 迁移：_summary 变成检查点事件，_ack 丢弃', () => {
  const v1 = [
    { role: 'user', content: '【上下文检查点：…】\n## 目标\n- x', _summary: { reason: 'auto' } },
    { role: 'assistant', content: '已了解之前的上下文，继续。', _ack: true },
    { role: 'user', content: 'u1' },
    { role: 'assistant', content: '', tool_calls: [{ id: 't1', type: 'function', function: { name: 'x', arguments: '{"a":1}' } }] },
    { role: 'tool', tool_call_id: 't1', name: 'x', content: 'R' },
  ];
  const events = migrateV1(v1);
  assert.deepEqual(events.map(e => e.t), ['summary', 'user', 'assistant', 'tool']);
  assert.match(events[0].content, /^## 目标/);
  assert.deepEqual(events[2].calls[0].args, { a: 1 });
  const h = History.fromJSON(v1);
  const v = h.view();
  assert.match(v[1].content, /^【上下文检查点/);
  assert.equal(v[2]._ack, true);              // 确认由 view() 重新生成
  assert.equal(v[3].role, 'user');
  assert.equal(v[3].content, 'u1');
});

test('archive: 新对话把完整事件归档到 .chats/', () => {
  const dir = tmp();
  const h = sample();
  const f = h.archive(dir);
  assert.ok(f && fs.existsSync(f));
  assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).events.length, 4);
  h.reset();
  assert.equal(h.events.length, 0);
  assert.equal(h.archive(tmp()), null);                     // 空历史不归档
});

test('stats: 裁剪后 token 数下降，信息与 view 一致', async () => {
  const { contextTokens } = await import('../context.mjs');
  const dir = tmp();
  const h = new History({ system: 'S' });
  for (let i = 0; i < 8; i++) { h.append({ t: 'assistant', content: '', calls: [{ id: 'c' + i, name: 'n', args: {} }] }); h.append({ t: 'tool', id: 'c' + i, name: 'n', content: ('y' + i).repeat(4500) }); }
  const raw = contextTokens(h.view());                       // 不裁剪
  h.ctxDir = dir;
  const pruned = h.stats().tokens;                           // 默认按 view 的裁剪规则统计（保留最近 6 条）
  assert.ok(raw - pruned > 4000, `期望明显下降：${raw} → ${pruned}`);
  assert.equal(h.stats().messages, h.view({ prune: { keep: 6, minChars: 6000, dir } }).length);
});

test('view: 孤儿 tool 结果被跳过（防御旧数据）', () => {
  const h = new History({ system: 'S' });
  h.events = [{ t: 'tool', id: 'x', name: 'n', content: 'r' }, { t: 'user', content: 'u' }];
  const v = h.view();
  assert.deepEqual(v.map(m => m.role), ['system', 'user']);
});
