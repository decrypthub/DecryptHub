// 输出膨胀策略：参考 DSH `spill-policy/retention.ts`。
// 核心：**首尾各保留 + 中间打洞**，而不是只留开头。
// 工具输出（报错堆栈、脚本尾部、汇总行、退出码）的关键信息常在末尾，
// 只砍尾巴会让模型看不到结论，只能重跑一遍命令 —— 这是"一轮一轮踩坑"的来源之一。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { retainEnds, safeSlice, trimToolOutput } from '../context.mjs';

test('safeSlice 不会把 UTF-16 代理对切成两半', () => {
  // emoji 占两个 code unit；任何切点都不该产生孤立代理
  const text = '😀😀😀😀😀';
  for (let n = 0; n <= text.length; n++) {
    for (const fromEnd of [false, true]) {
      const out = safeSlice(text, n, fromEnd);
      // 孤立代理的特征：末尾是高位代理，或开头是低位代理
      const first = out.charCodeAt(0), last = out.charCodeAt(out.length - 1);
      assert.ok(!(last >= 0xd800 && last <= 0xdbff), `从尾部切片在 n=${n} 时产生了孤立高位代理`);
      assert.ok(!(first >= 0xdc00 && first <= 0xdfff), `从头部切片在 n=${n} 时产生了孤立低位代理`);
    }
  }
});

test('短文本原样返回，不产生省略标记', () => {
  const r = retainEnds('short', 100);
  assert.equal(r.head, 'short');
  assert.equal(r.tail, '');
  assert.equal(r.omittedChars, 0);
});

test('长文本首尾都保留，中间被省略', () => {
  const head = 'H'.repeat(500), middle = 'M'.repeat(5000), tail = 'T'.repeat(500);
  const text = head + middle + tail;
  const r = retainEnds(text, 600);
  assert.ok(r.head.startsWith('H'), '开头必须在');
  assert.ok(r.tail.endsWith('T'), '结尾必须在——这是关键信息所在');
  assert.ok(r.omittedChars > 0);
  assert.equal(r.head.length + r.tail.length + r.omittedChars, text.length);
});

test('头尾预算各占一半，不会一边独占', () => {
  const text = 'A'.repeat(2000) + 'B'.repeat(2000);
  const r = retainEnds(text, 400);
  assert.ok(Math.abs(r.head.length - r.tail.length) <= 1, `头 ${r.head.length} 与尾 ${r.tail.length} 应当大致相等`);
});

test('trimToolOutput 保留尾部信息（退出码/汇总行不再丢失）', () => {
  const body = Array.from({ length: 4000 }, (_, i) => `line ${i} 一些内容`).join('\n');
  const text = body + '\nEXIT CODE: 42\nSUMMARY: 完成 3 项';
  const out = trimToolOutput(text, { name: 'workspace_shell', head: 800 });
  assert.ok(out.includes('EXIT CODE: 42'), '退出码必须可见');
  assert.ok(out.includes('SUMMARY: 完成 3 项'), '汇总行必须可见');
  assert.ok(out.includes('中段省略'), '必须明确告诉模型中间被省略了');
  assert.ok(out.includes('line 0'), '开头也要保留');
});

test('trimToolOutput 说明原文总长度，便于模型判断要不要读全文', () => {
  const text = 'x'.repeat(50000);
  const out = trimToolOutput(text, { head: 500 });
  assert.match(out, /原 50000 字符/);
});

test('有存档目录时给出 context_ref_read 引用', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-ctx-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const text = 'A'.repeat(100) + 'B'.repeat(20000);
  const out = trimToolOutput(text, { dir, name: 'workspace_read', head: 600 });
  const m = /context_ref_read\(ref="(ctx_[0-9a-f]{10})"/.exec(out);
  assert.ok(m, '应当给出可读的 ref');
  // 存档内容必须是完整原文
  const saved = fs.readFileSync(path.join(dir, m[1] + '.txt'), 'utf8');
  assert.equal(saved, text, '存档必须是完整原文，不能是截断版');
});

test('未超限时不写引用也不加省略标记（不做无谓的存档）', () => {
  const out = trimToolOutput('short output', { name: 'workspace_read', head: 600 });
  assert.equal(out, 'short output');
});
