// 权限预设：三档可选项 + 由两个旋钮推导的当前值。
// 对应 DSH 的 packages/interaction/permission-presets/tests/permission-presets.spec.ts。
// 这里锁的是**语义**，不是文案：档位数、顺序、custom 不可选、切换只写有效变化的旋钮。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  PERMISSION_PRESETS, CUSTOM_PRESET, FULL_ACCESS_PRESET, PRESET_CLI_NAMES,
  currentPreset, presetLabel, presetDescription, presetKnobs, resolvePreset, presetCliName, presetStatusLine,
} from '../permission-presets.mjs';

test('预设表只有三档，顺序与 DSH 一致', () => {
  assert.deepEqual(PERMISSION_PRESETS.map(p => p.id), ['read-only', 'workspace-write', 'full-access']);
  assert.deepEqual(PERMISSION_PRESETS.map(p => p.label), ['仅可查看', '工作区内修改', '完全权限']);
  // 每一档都必须有名字和说明：trigger 的 title 直接取说明，缺了会变成空提示。
  for (const preset of PERMISSION_PRESETS) {
    assert.ok(preset.label.length > 0, preset.id + ' 缺名字');
    assert.ok(preset.description.length > 10, preset.id + ' 缺说明');
  }
});

test('两个旋钮推导当前预设；规则自动批准推导为 custom', () => {
  assert.equal(currentPreset('read-only', 'manual'), 'read-only');
  assert.equal(currentPreset('standard', 'manual'), 'workspace-write');
  assert.equal(currentPreset('full-access', 'manual'), 'full-access');
  // review=auto 与任何预设的审批方式都不同 → 不能归到「工作区内修改」。
  assert.equal(currentPreset('standard', 'auto'), CUSTOM_PRESET);
  assert.equal(currentPreset('read-only', 'auto'), CUSTOM_PRESET);
  // 缺省/脏值按最保守的一档推导，不凭空提升权限。
  assert.equal(currentPreset(undefined, undefined), 'workspace-write');
  assert.equal(currentPreset('danger', 'nonsense'), 'workspace-write');
});

test('custom 可以显示为当前值，但永远不是可选行', () => {
  assert.equal(presetLabel(CUSTOM_PRESET), '自动批准');
  assert.ok(presetDescription(CUSTOM_PRESET).includes('规则'));
  assert.equal(PERMISSION_PRESETS.some(p => p.id === CUSTOM_PRESET), false, 'custom 不能出现在可选表里');
  // 它不是切换目标：resolvePreset 只认三档（及其别名）。
  assert.equal(resolvePreset('custom'), undefined);
  assert.equal(resolvePreset('auto'), undefined);
  assert.equal(FULL_ACCESS_PRESET, 'full-access');
});

test('切换预设只写两个成对的旋钮，且与预设一一对应', () => {
  assert.deepEqual(presetKnobs('read-only'), { mode: 'read-only', review: 'manual' });
  assert.deepEqual(presetKnobs('workspace-write'), { mode: 'standard', review: 'manual' });
  assert.deepEqual(presetKnobs('full-access'), { mode: 'full-access', review: 'manual' });
  // 每个预设写回后必须推导回它自己，否则界面显示与实际执行会分叉。
  for (const { id } of PERMISSION_PRESETS) {
    const knobs = presetKnobs(id);
    assert.equal(currentPreset(knobs.mode, knobs.review), id, id + ' 写回后推导不回自己');
  }
});

test('命令行预设名同时接受 DSH 的 machine value 与历史内部名', () => {
  assert.equal(resolvePreset('read-only'), 'read-only');
  assert.equal(resolvePreset('workspace-write'), 'workspace-write');
  assert.equal(resolvePreset('danger-full-access'), 'full-access');
  // 历史叫法：standard / full-access 是 DecryptHub 内部一直用的值。
  assert.equal(resolvePreset('standard'), 'workspace-write');
  assert.equal(resolvePreset(' full-access '), 'full-access');
  assert.equal(resolvePreset('FULL-ACCESS'), 'full-access');
  assert.equal(resolvePreset('danger'), undefined);
  assert.equal(resolvePreset(''), undefined);
  assert.equal(resolvePreset(null), undefined);
});

test('提示行用对外名，不暴露内部旋钮值', () => {
  assert.deepEqual(PRESET_CLI_NAMES, ['read-only', 'workspace-write', 'danger-full-access']);
  assert.equal(presetCliName('workspace-write'), 'workspace-write');
  assert.equal(presetCliName('full-access'), 'danger-full-access');
  assert.equal(presetCliName('read-only'), 'read-only');
  const line = presetStatusLine('workspace-write');
  assert.ok(!line.includes('standard'), '提示行不能出现内部值 standard：' + line);
  assert.ok(line.includes('danger-full-access'), '提示行必须列出可用预设');
});

test('预设模块零顶层 import，UI 引用它不会把 Node 内置模块带进浏览器产物', () => {
  // BASELINE「坑 0」：ui/src 引用带 node: 顶层 import 的 sidecar 模块，Vite 会把内置模块打进 bundle，
  // 动态 import 挡不住。这个模块同时被 ui/src 和 sidecar 使用，所以只能是纯常量 + 纯函数。
  const source = fs.readFileSync(path.join(import.meta.dirname, '..', 'permission-presets.mjs'), 'utf8');
  assert.equal(/^import\s/m.test(source), false, '不能有任何顶层 import：' + source.split('\n').find(l => /^import\s/.test(l)));
  assert.equal(/require\(/.test(source), false, '不能有 require');
});
