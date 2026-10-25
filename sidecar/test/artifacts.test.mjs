// 「AI 写的」索引：分类、去重、时间倒序。
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectArtifacts, groupArtifacts, kindOf } from '../artifacts.mjs';

const tool = (name, wrote, at = 1) => ({ t: 'tool', name, wrote, at });

test('kindOf: 脚本 / 笔记 / 数据', () => {
  assert.equal(kindOf('signature.js'), 'script');
  assert.equal(kindOf('workspace/a.py'), 'script');
  assert.equal(kindOf('findings.md'), 'doc');
  assert.equal(kindOf('report.md', 'generate_report'), 'doc');
  assert.equal(kindOf('page-env.json'), 'data');
  assert.equal(kindOf('capture.har'), 'data');
  // 工具优先于扩展名（notes_write 写什么都算笔记）
  assert.equal(kindOf('weird.bin', 'notes_write'), 'doc');
});

test('collectArtifacts: 只认工具声明写过的文件，去重取最近一次', () => {
  const events = [
    { t: 'user', content: 'x' },
    { t: 'assistant', content: '', calls: [{ name: 'workspace_read', args: {} }] },
    tool('workspace_read', undefined, 1), // 只读工具没有 wrote
    tool('workspace_write', ['workspace/a.js'], 10),
    tool('workspace_edit', ['workspace/a.js'], 20),
    tool('export_code', ['signature.js'], 30),
    tool('notes_write', ['findings.md'], 40),
  ];
  const list = collectArtifacts(events);
  assert.deepEqual(list.map(a => a.path), ['findings.md', 'signature.js', 'workspace/a.js']);
  const a = list.find(x => x.path === 'workspace/a.js');
  assert.equal(a.writes, 2);
  assert.equal(a.at, 20);
  assert.equal(a.name, 'a.js');
  assert.equal(a.kind, 'script');
  assert.equal(a.tool, 'workspace_edit');
});

test('collectArtifacts: 反斜杠路径归一化，隐藏/异常项被跳过', () => {
  const list = collectArtifacts([tool('workspace_write', ['workspace\\win\\x.js', '', null, 123], 5)]);
  assert.deepEqual(list.map(a => a.path), ['workspace/win/x.js']);
  assert.equal(list[0].name, 'x.js');
});

test('collectArtifacts: 空事件/无 wrote 安全返回空数组', () => {
  assert.deepEqual(collectArtifacts([]), []);
  assert.deepEqual(collectArtifacts(undefined), []);
  assert.deepEqual(collectArtifacts([{ t: 'tool', name: 'x', wrote: null }]), []);
});

test('groupArtifacts: 脚本 → 笔记 → 数据，空组不出现', () => {
  const list = collectArtifacts([
    tool('workspace_write', ['workspace/a.js'], 1),
    tool('notes_write', ['findings.md'], 2),
    tool('capture_page_env', ['env.json'], 3),
  ]);
  const groups = groupArtifacts(list);
  assert.deepEqual(groups.map(g => g.kind), ['script', 'doc', 'data']);
  assert.equal(groups[0].items[0].path, 'workspace/a.js');
  const only = groupArtifacts(collectArtifacts([tool('export_code', ['signature.js'], 1)]));
  assert.deepEqual(only.map(g => g.kind), ['script']);
});
