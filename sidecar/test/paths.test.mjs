// 路径约束：唯一的 resolveIn() 实现 + 工具侧真的用上了它。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveIn, tryResolveIn } from '../paths.mjs';
import { DEFAULT_TOOLS } from '../catalog.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wdh-path-'));

test('resolveIn: 允许根目录内的一切写法', () => {
  const root = tmp();
  assert.equal(resolveIn(root, 'a.js'), path.join(root, 'a.js'));
  assert.equal(resolveIn(root, 'sub/dir/a.js'), path.join(root, 'sub', 'dir', 'a.js'));
  assert.equal(resolveIn(root, 'sub/../a.js'), path.join(root, 'a.js'));   // 绕回来仍在根内
  assert.equal(resolveIn(root, ''), root);
  assert.equal(resolveIn(root, '.'), root);
  // 落在根内的绝对路径也允许
  assert.equal(resolveIn(root, path.join(root, 'b.js')), path.join(root, 'b.js'));
});

test('resolveIn: 拒绝越界（父目录、绝对路径、同名前缀的兄弟目录）', () => {
  const base = tmp();
  const root = path.join(base, 'project');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(base, 'project-evil'), { recursive: true });
  assert.throws(() => resolveIn(root, '../x'), /路径越界/);
  assert.throws(() => resolveIn(root, '../project-evil/x'), /路径越界/);
  assert.throws(() => resolveIn(root, path.join(base, 'etc', 'passwd')), /路径越界/);
  // 旧实现用裸 startsWith，会把 project-evil 当成 project 的子目录
  assert.throws(() => resolveIn(root, path.join(base, 'project-evil', 'x')), /路径越界/);
});

test('resolveIn: 错误信息带原样入参，模型能自己改', () => {
  const root = tmp();
  try { resolveIn(root, '../../secret'); assert.fail('应当抛错'); }
  catch (e) { assert.match(e.message, /\.\.\/\.\.\/secret/); assert.match(e.message, /相对路径/); }
});

test('tryResolveIn: 越界返回 null 而不抛', () => {
  const root = tmp();
  assert.equal(tryResolveIn(root, '../x'), null);
  assert.ok(tryResolveIn(root, 'ok.js'));
});

test('注册的 workspace_read 拒绝工作区外的相对和绝对路径', async () => {
  const tool = DEFAULT_TOOLS.find(t => t.name === 'workspace_read');
  const root = tmp();
  await assert.rejects(() => tool.run({ path: '../../../etc/passwd' }, { workRoot: root }), /路径越界/);
  await assert.rejects(() => tool.run({ path: path.resolve(root, '..', 'x.js') }, { workRoot: root }), /路径越界/);
});

test('注册的 workspace_write 拒绝工作区外写入，专用工具不进入核心', async () => {
  assert.ok(!DEFAULT_TOOLS.some(t => ['net_load_har', 'deobfuscate_code'].includes(t.name)));
  const tool = DEFAULT_TOOLS.find(t => t.name === 'workspace_write');
  const root = tmp();
  await assert.rejects(() => tool.run({ path: '../../secret.har', content: 'must not write' }, { workRoot: root }), /路径越界/);
});
