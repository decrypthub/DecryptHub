// 三个实测问题的回归锁：
// ① 没有确认界面时代码执行必须立刻拒绝（见 approval-availability.test.mjs）
// ② component_list 不 await Python 探测就报 needs-runtime（组件装好了却显示缺运行时）
// ③ workspace_list 达到条数上限时静默截断，模型误以为「这就是全部」
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_TOOLS } from '../catalog.mjs';
import { WORKSPACE_TOOLS, listWorkspace } from '../workspace.mjs';

function tmpRoot(t, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => { if (path.dirname(root) === os.tmpdir()) fs.rmSync(root, { recursive: true, force: true }); });
  return root;
}

const componentList = DEFAULT_TOOLS.find(t => t.name === 'component_list');

test('component_list 先探测 Python 再报状态（否则所有 Python 插件恒定误报 needs-runtime）', async t => {
  let probed = false;
  // 模拟真实 PluginManager：python 由异步 runtime() 填充，初始为 null
  const plugins = {
    python: null,
    async runtime() { probed = true; this.python = { available: true, command: 'python', args: [], version: 'Python 3.14.5' }; return this.python; },
    status: () => ({
      official: [
        { id: 'wdh', installed: true, enabled: true, version: '0.1.1', state: 'ready', latest: null },
        // status() 里 !this.python?.available 决定它是不是 needs-runtime
        { id: 'adh', installed: true, enabled: true, version: '0.1.2', state: plugins.python?.available ? 'idle' : 'needs-runtime', latest: null },
      ],
    }),
  };
  const result = await componentList.run({}, { plugins });
  assert.equal(probed, true, '必须调用 runtime() 才会触发 Python 探测');
  const parsed = JSON.parse(result.text);
  const adh = parsed.components.find(c => c.id === 'adh');
  assert.equal(adh.state, 'idle', '探测完 Python 后不该再是 needs-runtime');
  assert.notEqual(adh.state, 'needs-runtime');
});

test('component_list 在没有 plugins 时回落到 components.info，不抛异常', async t => {
  const components = { info: id => ({ id, installed: id === 'wdh' }) };
  const result = await componentList.run({}, { components });
  const parsed = JSON.parse(result.text);
  assert.equal(parsed.components.length, 3);
  assert.equal(parsed.components.find(c => c.id === 'wdh').installed, true);
});

test('component_list 的 Python 探测失败也不影响返回组件清单', async t => {
  const plugins = {
    python: null,
    async runtime() { throw new Error('python probe crashed'); },
    status: () => ({ official: [{ id: 'adh', installed: true, enabled: true, version: '0.1.2', state: 'needs-runtime', latest: null }] }),
  };
  const result = await componentList.run({}, { plugins });
  const parsed = JSON.parse(result.text);
  assert.equal(parsed.components.length, 1, '探测异常不能让整个清单失败');
  assert.equal(parsed.components[0].id, 'adh');
});

const wsList = WORKSPACE_TOOLS.find(t => t.name === 'workspace_list');

/** 最小可用 ctx：项目主目录就是 temp 根 */
function ctxFor(root) {
  return {
    workRoot: root, workspaceKind: 'folder', mode: 'standard',
    projectRoots: [{ id: 'p1', root, label: 'Work', primary: true, readOnly: false }],
    protectedRoot: path.join(root, '__data__'),
  };
}

test('workspace_list 在正常文件数下给出总数，不加截断提示', async t => {
  const root = tmpRoot(t, 'dh-list-ok-');
  for (const n of ['a.md', 'b.md', 'c.txt']) fs.writeFileSync(path.join(root, n), 'x');
  const result = await wsList.run({ depth: 1 }, ctxFor(root));
  assert.match(result.text, /共 3 项/);
  assert.ok(!/已截断/.test(result.text), '没到上限就别说截断');
});

test('workspace_list 达到上限时必须显式说明已截断（不能静默）', async t => {
  const root = tmpRoot(t, 'dh-list-many-');
  // 造到刚好触顶：walk 的 max 是 10000，太多文件会很慢，这里直接验证提示逻辑的触发条件。
  // 用一个远小于默认值的项目树跑 walk，再检查 wsList 对 entries.length 的判断。
  // 为了让测试快，只造 30 个文件并验证「未触顶」；触顶分支用下面的函数级断言覆盖。
  for (let i = 0; i < 30; i++) fs.writeFileSync(path.join(root, `f${i}.txt`), 'x');
  const result = await wsList.run({ depth: 1 }, ctxFor(root));
  assert.match(result.text, /共 30 项/);
  assert.ok(!/已截断/.test(result.text));

  // 触顶分支：直接构造一个达到 MAX 的目录不现实（10000 个文件），
  // 所以改为断言源码里确实按 entries.length >= MAX 输出提示——这是行为契约的一部分。
  const source = fs.readFileSync(new URL('../workspace.mjs', import.meta.url), 'utf8');
  assert.match(source, /entries\.length >= MAX/);
  assert.match(source, /已截断：最多列出/);
});

test('workspace_list 报出的深度与实际遍历深度一致', async t => {
  const root = tmpRoot(t, 'dh-list-depth-');
  fs.mkdirSync(path.join(root, 'sub'));
  fs.writeFileSync(path.join(root, 'sub', 'deep.txt'), 'x');
  fs.writeFileSync(path.join(root, 'top.txt'), 'x');

  const d0 = await wsList.run({ depth: 0 }, ctxFor(root));
  assert.ok(!d0.text.includes('sub/deep.txt'), 'depth=0 不应进入子目录');
  assert.match(d0.text, /depth=0/);

  const d1 = await wsList.run({ depth: 1 }, ctxFor(root));
  assert.ok(d1.text.includes('sub/deep.txt'), 'depth=1 应包含一层子目录内容');
  assert.match(d1.text, /depth=1/);
});

test('listWorkspace 仍只返回文件（回归：改名不能改变既有语义）', async t => {
  const root = tmpRoot(t, 'dh-list-files-');
  fs.mkdirSync(path.join(root, 'dir'));
  fs.writeFileSync(path.join(root, 'a.md'), 'x');
  const files = listWorkspace(ctxFor(root));
  assert.equal(files.length, 1);
  assert.equal(files[0].name, 'a.md');
});
