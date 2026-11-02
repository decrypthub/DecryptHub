// 记忆/技能的三层边界：系统记忆只读、AI 记忆可管、插件声明的事实随连接状态变化。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { systemMemoryPrompt, pluginIdFromServerName, SYSTEM_MEMORY_SOURCES } from '../system-memory.mjs';
import { ExtensionStore } from '../extensions.mjs';
import { decideTool } from '../policy.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dh-memory-'));

test('system memory carries attribution discipline even with no plugin connected', () => {
  const text = systemMemoryPrompt();
  assert.match(text, /归因纪律/);
  // 「看不到屏幕」必须被当成能力描述，而不是判断对方在拦截。
  assert.match(text, /能力描述，不是结论/);
  assert.match(text, /反调试/);
  // 没有连接移动插件时不应出现设备操作段，避免在纯网页/文件任务里误导模型。
  assert.doesNotMatch(text, /移动设备操作/);
  assert.doesNotMatch(text, /插件声明的环境事实/);
});

test('a connected mobile plugin adds its own environment facts, a web plugin does not add device rules', () => {
  const android = systemMemoryPrompt({ plugins: [{ name: 'decrypthub_adh', instructions: 'adb is the operator channel to the phone.' }] });
  assert.match(android, /移动设备操作/);
  assert.match(android, /adb is the operator channel to the phone\./);
  assert.match(android, /Android 运行时分析工作台/);

  const web = systemMemoryPrompt({ plugins: [{ name: 'decrypthub_wdh', instructions: 'Control the browser.' }] });
  assert.doesNotMatch(web, /移动设备操作/);
  assert.match(web, /网页分析工作台/);
});

test('a plugin without instructions still marks the device class as available', () => {
  const text = systemMemoryPrompt({ plugins: [{ name: 'decrypthub_idh' }] });
  assert.match(text, /移动设备操作/);
  assert.doesNotMatch(text, /插件声明的环境事实/, 'no instructions means nothing to quote');
});

test('plugin instructions are clipped so one server cannot flood the system prompt', () => {
  const huge = 'x'.repeat(12000);
  const text = systemMemoryPrompt({ plugins: [{ name: 'decrypthub_adh', instructions: huge }] });
  assert.ok(text.length < 4200, 'system memory must stay bounded, got ' + text.length);
  assert.match(text, /已截断/);
});

test('a realistic ADH instruction block fits without being cut', () => {
  // ADH 的 initialize instructions 约 2.9k 字符；截断会把归因段落切掉，等于白写。
  const realistic = systemMemoryPrompt({ plugins: [{ name: 'decrypthub_adh', instructions: 'x'.repeat(2871) }] });
  assert.doesNotMatch(realistic, /已截断/);
});

test('official plugin ids come from the managed server prefix; custom servers keep their name', () => {
  assert.equal(pluginIdFromServerName('decrypthub_adh'), 'adh');
  assert.equal(pluginIdFromServerName('decrypthub_idh'), 'idh');
  assert.equal(pluginIdFromServerName('my-server'), 'my-server');
  assert.ok(SYSTEM_MEMORY_SOURCES.length > 0);
});

