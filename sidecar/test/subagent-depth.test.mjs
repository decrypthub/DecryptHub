// 委派深度：参考 DSH `subagent/depth.ts` 的核心不变量——
// 持久化深度是权威的，运行时值只能加深不能降低。
// 反例是致命的：子代理恢复时运行时上下文是全新的，从 0 重新计数会让它
// 重新获得委派额度，层级随每次恢复不断扩散，最终失控。
import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveDelegationDepth, assertDelegationDepth, MAX_DELEGATION_DEPTH } from '../subagents.mjs';

test('深度取持久化与运行时的较大者（恢复不能降级）', () => {
  // 正常：运行时已知更深
  assert.equal(effectiveDelegationDepth(1, 2), 2);
  // 关键反例：恢复后运行时是 0/未定义，但持久化记录是 2 —— 必须保留 2
  assert.equal(effectiveDelegationDepth(2, 0), 2);
  assert.equal(effectiveDelegationDepth(2, undefined), 2);
  assert.equal(effectiveDelegationDepth(undefined, 2), 2);
  // 都没有 = 顶级会话
  assert.equal(effectiveDelegationDepth(undefined, undefined), 0);
  assert.equal(effectiveDelegationDepth(0, 0), 0);
});

test('非法深度一律拒绝，不做静默归一', () => {
  for (const bad of [-1, 1.5, NaN, Infinity, -Infinity, '2', {}]) {
    assert.throws(() => assertDelegationDepth(bad, '测试'), TypeError, `${String(bad)} 应该被拒绝`);
  }
  // -0 也是非法（DSH 同样用 Object.is(value, -0) 拦掉）
  assert.throws(() => assertDelegationDepth(-0, '测试'), TypeError);
  // 合法的非负安全整数通过
  for (const ok of [0, 1, 2, Number.MAX_SAFE_INTEGER]) assert.equal(assertDelegationDepth(ok, '测试'), ok);
  // 缺省按顶级算
  assert.equal(assertDelegationDepth(undefined, '测试'), 0);
  assert.equal(assertDelegationDepth(null, '测试'), 0);
});

test('层级上限是显式常量，不是散落在调用点的魔数', () => {
  assert.equal(MAX_DELEGATION_DEPTH, 2);
  assert.ok(Number.isSafeInteger(MAX_DELEGATION_DEPTH));
  assert.ok(MAX_DELEGATION_DEPTH >= 1, '至少要允许一层，否则子代理功能不存在');
});

test('effectiveDelegationDepth 在任一侧非法时抛错（不吞掉坏数据）', () => {
  assert.throws(() => effectiveDelegationDepth(-1, 0), TypeError);
  assert.throws(() => effectiveDelegationDepth(0, -1), TypeError);
  assert.throws(() => effectiveDelegationDepth(1.5, 0), TypeError);
});
