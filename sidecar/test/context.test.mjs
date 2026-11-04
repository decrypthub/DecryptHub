import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { estimateTokens, contextTokens, modelLimit, limitInfo, compactTrigger, breakdown, microcompact, splitByTokens, buildSummaryRequest, splitForCompress, trimToolOutput, readRef, transcript, summaryFits } from '../context.mjs';

test('estimateTokens CJK vs latin', () => {
  assert.equal(estimateTokens('你好世界'), 4);
  assert.equal(estimateTokens('a'.repeat(36)), 10);
  assert.equal(estimateTokens(''), 0);
});
test('modelLimit', () => {
  assert.equal(modelLimit({ openai: { model: 'deepseek-v4.1-flash' } }), 1000000);
  assert.equal(modelLimit({ contextWindow: 32000 }), 32000);
  assert.equal(modelLimit({ provider: 'anthropic', anthropic: { model: 'claude-sonnet-4-5' } }), 200000);
});
test('splitForCompress keeps tool pairs and recent turns', () => {
  const m = [{ role: 'system', content: 's' },
    { role: 'user', content: 'u1' }, { role: 'assistant', content: '', tool_calls: [{ id: 't1', function: { name: 'x', arguments: '{}' } }] }, { role: 'tool', tool_call_id: 't1', content: 'r' }, { role: 'assistant', content: 'a1' },
    { role: 'user', content: 'u2' }, { role: 'assistant', content: 'a2' },
    { role: 'user', content: 'u3' }, { role: 'assistant', content: 'a3' }];
  const { old, recent } = splitForCompress(m, 2);
  assert.equal(old.length, 4); assert.equal(recent[0].content, 'u2'); assert.equal(recent.length, 4);
  assert.ok(contextTokens(m) > 0); assert.match(transcript(old), /调用工具\]: x/);
});
test('single long turn splits at non-tool boundary', () => {
  const m = [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }];
  for (let i = 0; i < 10; i++) { m.push({ role: 'assistant', content: '', tool_calls: [{ id: 't' + i, function: { name: 'n', arguments: '{}' } }] }); m.push({ role: 'tool', tool_call_id: 't' + i, content: 'x' }); }
  const { old, recent } = splitForCompress(m, 2);
  assert.ok(old.length > 0); assert.notEqual(recent[0].role, 'tool');
});
test('trimToolOutput stores ref and readRef pages', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-'));
  const big = 'r12 ' + 'x'.repeat(20000);
  const t = trimToolOutput(big, { dir, name: 'net_list' });
  const ref = t.match(/ctx_[0-9a-f]{10}/)[0];
  assert.ok(t.length < 2500); assert.match(t, /net_get\(id\)/);
  const r = readRef(dir, ref, 100, 500); assert.match(r.text, /100-600\/20004/);
  assert.equal(readRef(dir, '../etc/passwd').isError, true);
  assert.equal(trimToolOutput('short', { dir }), 'short');
});

test('per-model window, legacy and inferred', () => {
  assert.deepEqual(limitInfo({ provider: 'openai', openai: { model: 'deepseek-v4.1-flash', contextWindow: 1000000 } }), { limit: 1000000, inferred: false });
  assert.deepEqual(limitInfo({ provider: 'openai', openai: { model: 'deepseek-v4.1-flash' } }), { limit: 1000000, inferred: true });
  assert.equal(modelLimit({ provider: 'anthropic', anthropic: { model: 'claude-x', contextWindow: 500000 }, openai: { contextWindow: 128000 } }), 500000);
});
test('selected model capacity wins over stale provider mirrors and does not leak across models', () => {
  const s = { provider: 'openai', openai: { model: 'old', contextWindow: 128000 }, activeProviderId: 'p', activeModel: { id: 'million' }, providers: [{ id: 'p', models: [{ id: 'million', contextWindow: 1048576 }, { id: 'small', contextWindow: 32000 }, { id: 'deepseek-flash' }] }] };
  assert.deepEqual(limitInfo(s), { limit: 1048576, inferred: false });
  s.activeModel = 'small'; assert.equal(modelLimit(s), 32000);
  s.activeModel = 'deepseek-flash'; assert.deepEqual(limitInfo(s), { limit: 1000000, inferred: true });
  assert.equal(modelLimit({ openai: { model: 'deepseek-v3.2' } }), 128000);
});
test('compactTrigger uses threshold and reserve', () => {
  assert.equal(compactTrigger(128000, 0.85), 108800);
  assert.equal(compactTrigger(1000000, 0.85), 850000);
  assert.equal(compactTrigger(30000, 0.95), 27000); // 10% 预留
});
test('breakdown categories and microcompact', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-'));
  const m = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'q ' + 'a'.repeat(3600), _attTok: 900 }];
  for (let i = 0; i < 5; i++) m.push({ role: 'tool', name: 'net_get', content: 'y'.repeat(5000) });
  const b = breakdown(m, [{ name: 't' }]);
  assert.ok(b.attachments === 900 && b.toolResults > 6000 && b.tools > 0 && b.system > 0);
  const r = microcompact(m, { dir, keep: 3 });
  assert.equal(r.count, 2); assert.ok(r.saved > 2000);
  assert.match(m[2].content, /ctx_[0-9a-f]{10}/); assert.equal(m[6].content.length, 5000);
  assert.equal(microcompact(m, { dir, keep: 3 }).count, 0);
});
test('splitByTokens keeps recent budget and previous summary', () => {
  const m = [{ role: 'system', content: 's' }, { role: 'user', _summary: {}, content: '【检查点】\nOLD' }, { role: 'assistant', _ack: true, content: 'ok' }];
  for (let i = 0; i < 6; i++) m.push({ role: 'user', content: 'u' + i + ' ' + 'z'.repeat(360) }, { role: 'assistant', content: '', tool_calls: [{ id: 'c' + i, function: { name: 'n', arguments: '{}' } }] }, { role: 'tool', content: 'r'.repeat(360) }, { role: 'assistant', content: 'a' + i });
  const { previousSummary, old, recent } = splitByTokens(m, 250);
  assert.equal(previousSummary, 'OLD'); assert.notEqual(recent[0].role, 'tool');
  assert.ok(old.length > 10 && recent.length >= 1); assert.ok(!old.some(x => x._summary || x._ack));
  const req = buildSummaryRequest(old, { previousSummary, instructions: '关注 sign 算法' });
  assert.match(req.messages[1].content, /<previous-summary>/); assert.match(req.messages[1].content, /关注 sign 算法/); assert.match(req.messages[1].content, /## 下一步/);
  // 不给 system 时仍是「自建摘要 system + 一条转写 user」，保持既有调用方可用的旧形状
  assert.match(req.messages[0].content, /检查点生成器/);
  assert.deepEqual(transcript(old).length > 0, true);
});

test('buildSummaryRequest: 给了 system 就走前缀复用（原对话原样重放 + 末尾指令）', () => {
  const old = [
    { role: 'user', content: '帮我找 sign' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'c1', name: 'read', content: '源码' },
  ];
  const system = '你是桌面端通用 Agent。';
  const req = buildSummaryRequest(old, { system, tools: [{ name: 'read', schema: {} }] });
  // 前 N 条必须与真实请求逐字节相同：前缀只要差一个字符，KV 缓存就整段失效。
  assert.equal(req.messages[0].content, system);
  assert.deepEqual(req.messages.slice(1, 1 + old.length), old);
  // 指令作为最后一条 user 消息，而不是塞进 system
  const last = req.messages.at(-1);
  assert.equal(last.role, 'user');
  assert.match(last.content, /上下文检查点生成任务/);
  assert.match(last.content, /## 目标/);
  assert.equal(req.tools.length, 1, '工具定义要一起重放，否则系统提示里的工具前缀对不上');
  assert.equal(req.messages.filter(m => m.content === system).length, 1, 'system 不能重复出现');
});

test('summaryFits: 摘要不小于被替换区间时必须拒绝', () => {
  const tiny = summaryFits('短', 1000);
  assert.equal(tiny.ok, true);
  const huge = summaryFits('z'.repeat(20000), 1000);
  assert.equal(huge.ok, false);
  assert.ok(huge.excess > 0);
  // 帧化前缀本身也计入：空摘要对着 0 token 的区间也不算更小
  assert.equal(summaryFits('', 0).ok, false);
});
