// 文件树状态机：把 DeepSeek Harness 的语义逐条钉住。
//
// 这些断言全部来自实读 `ui-sidebar-files/src/client/store.ts` 与 `FileTree.tsx`，
// 每一条都对应一个「不这么做就会出事」的具体后果，不是凭感觉加的保护。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  childPath, treeRootOf, emptyTree, ensureTree, markLoading, applyListing, applyFailure,
  toggleExpanded, orderEntries, treeRows, directoryStates, locateFile, relativeToRoot,
  failureKind, LISTING, FILE_ERRORS,
} from '../src/file-tree-model.js';

const ROOT = 'C:\\proj\\workspace';
const SRC = childPath(ROOT, 'src');
const DEEP = childPath(SRC, 'deep');

const entry = (name, type = 'file', size) => ({ name, type, ...(size === undefined ? {} : { size }) });
const ready = (entries, truncated = false) => ({ kind: LISTING.READY, level: { entries, truncated } });

/** 一棵「根已列出 src」的树，多数用例的起点。 */
function treeWithSrc() {
  let tree = emptyTree(ROOT);
  tree = applyListing(tree, ROOT, { entries: [entry('src', 'directory'), entry('README.md', 'file', 12)] });
  tree = applyListing(tree, SRC, { entries: [entry('main.js', 'file', 3)] });
  return toggleExpanded(tree, SRC, true);
}

test('childPath 去掉父路径的尾部分隔符再接名字（保留父路径原有分隔符，与 DSH 一致）', () => {
  // DSH: `${parent.replace(/[/\\]+$/, '')}/${name}` —— 只去掉尾部再追加 `/`，
  // 不把父路径里的反斜杠换成斜杠。键只需要稳定，不需要跨平台统一写法。
  assert.equal(childPath('C:\\proj\\workspace', 'src'), 'C:\\proj\\workspace/src');
  assert.equal(childPath('C:\\proj\\workspace\\', 'src'), 'C:\\proj\\workspace/src');
  assert.equal(childPath('/a/b/', 'c'), '/a/b/c');
  assert.equal(childPath('/a/b///', 'c'), '/a/b/c');
});

test('treeRootOf 去掉尾部分隔符：POSIX 根变空串，盘根 C:\\ 变 C:', () => {
  assert.equal(treeRootOf('/'), '');
  assert.equal(treeRootOf('C:\\'), 'C:');
  assert.equal(treeRootOf('/a/b/'), '/a/b');
});

test('ensureTree 根变了就换新树（旧层的键全部失效，不能复用）', () => {
  const tree = treeWithSrc();
  assert.equal(ensureTree(tree, ROOT), tree, '根一致必须返回原对象，否则每帧都重建状态');
  const moved = ensureTree(tree, 'C:\\other');
  assert.equal(moved.root, 'C:\\other');
  assert.deepEqual(moved.levels, {}, '换根后不能带着旧根下读到的层');
  assert.deepEqual(moved.expanded, ['C:\\other'], '新树只展开根');
});

test('重新列举期间保留旧条目（否则整棵树闪空重绘）', () => {
  const tree = treeWithSrc();
  const loading = markLoading(tree, SRC);
  const level = loading.levels[SRC];
  assert.equal(level.kind, LISTING.READY, '已有清单不能退回 loading');
  assert.equal(level.refreshing, true);
  assert.equal(level.level.entries.length, 1, '旧条目必须还在');
});

test('从未读过的层标 loading；重复标记不会把 refreshing 叠成两层', () => {
  const tree = emptyTree(ROOT);
  assert.equal(markLoading(tree, ROOT).levels[ROOT].kind, LISTING.LOADING);
  const once = markLoading(treeWithSrc(), SRC);
  const twice = markLoading(once, SRC);
  assert.equal(twice.levels[SRC].refreshing, true);
  assert.deepEqual(twice.levels[SRC].level.entries, once.levels[SRC].level.entries);
});

test('某目录重新列举后不再包含某子目录 → 该子目录及其全部后代从展开集与缓存里剪掉', () => {
  let tree = treeWithSrc();
  tree = applyListing(tree, SRC, { entries: [entry('deep', 'directory')] });
  tree = toggleExpanded(tree, DEEP, true);
  tree = applyListing(tree, DEEP, { entries: [entry('x.js', 'file')] });
  assert.ok(tree.expanded.includes(DEEP));

  // src 重列后 deep 不见了
  tree = applyListing(tree, SRC, { entries: [entry('main.js', 'file')] });
  assert.equal(tree.expanded.includes(DEEP), false, '被删的目录不能留在展开集里');
  assert.equal(tree.levels[DEEP], undefined, '被删目录的缓存也要一起丢');
});

test('删除的目录有同名「兄弟前缀」时不能误剪（src/a 与 src/ab 互不影响）', () => {
  let tree = emptyTree(ROOT);
  tree = applyListing(tree, ROOT, { entries: [entry('a', 'directory'), entry('ab', 'directory')] });
  const a = childPath(ROOT, 'a'), ab = childPath(ROOT, 'ab');
  tree = toggleExpanded(tree, a, true);
  tree = toggleExpanded(tree, ab, true);
  tree = applyListing(tree, ROOT, { entries: [entry('ab', 'directory')] });
  assert.equal(tree.expanded.includes(a), false);
  assert.equal(tree.expanded.includes(ab), true, 'src/ab 不能被当成 src/a 的后代剪掉');
});

test('列举失败时旧条目保留，只挂失败信息（不能把已显示的行一起吞掉）', () => {
  const failure = { code: FILE_ERRORS.NOT_FOUND, message: 'gone' };
  const tree = applyFailure(treeWithSrc(), SRC, failure);
  const level = tree.levels[SRC];
  assert.equal(level.kind, LISTING.READY);
  assert.equal(level.level.entries.length, 1);
  assert.equal(level.failure, failure);
});

test('从未读成的层失败即整层失败；失败会清掉下面所有层的 refreshing', () => {
  let tree = emptyTree(ROOT);
  const failure = { code: FILE_ERRORS.OUTSIDE, message: 'nope' };
  assert.equal(applyFailure(tree, ROOT, failure).levels[ROOT].kind, LISTING.FAILED);

  tree = treeWithSrc();
  tree = applyListing(tree, SRC, { entries: [entry('deep', 'directory')] });
  const deep = childPath(SRC, 'deep');
  tree = toggleExpanded(tree, deep, true);
  tree = applyListing(tree, deep, { entries: [] });
  tree = markLoading(tree, deep);
  assert.equal(tree.levels[deep].refreshing, true);
  tree = applyFailure(tree, SRC, failure);
  assert.equal(tree.levels[deep].refreshing, undefined, '父目录都没读成，子层不该再显示「正在重列」');
});

test('折叠保留已读内容：重新展开立刻能画，不需要再请求', () => {
  const tree = treeWithSrc();
  const collapsed = toggleExpanded(tree, SRC, false);
  assert.equal(collapsed.expanded.includes(SRC), false);
  assert.equal(collapsed.levels[SRC].kind, LISTING.READY, '折叠不能删缓存');
  const reopened = toggleExpanded(collapsed, SRC, true);
  assert.deepEqual(treeRows(reopened).map(row => row.name), ['src', 'main.js', 'README.md']);
});

test('toggleExpanded 指定目标状态时幂等（事件重复触发不会来回翻）', () => {
  const tree = treeWithSrc();
  assert.equal(toggleExpanded(tree, SRC, true), tree);
  const collapsed = toggleExpanded(tree, SRC, false);
  assert.equal(toggleExpanded(collapsed, SRC, false), collapsed);
});

test('排序：目录优先，再按自然序、不区分大小写（file2 在 file10 之前）', () => {
  const ordered = orderEntries([
    entry('file10'), entry('file2'), entry('Zeta', 'directory'), entry('alpha', 'directory'), entry('Beta'),
  ]);
  assert.deepEqual(ordered.map(e => e.name), ['alpha', 'Zeta', 'Beta', 'file2', 'file10']);
});

test('other 类型既不进目录组也不被当成可打开的文件', () => {
  assert.deepEqual(orderEntries([entry('link', 'other'), entry('dir', 'directory')]).map(e => e.name), ['dir', 'link']);
});

test('treeRows 只走真实列出的层；展开但没读到内容的目录不出行', () => {
  let tree = emptyTree(ROOT);
  tree = applyListing(tree, ROOT, { entries: [entry('src', 'directory'), entry('README.md')] });
  tree = toggleExpanded(tree, SRC, true);
  // src 已展开但还没列举 → 不画 src 的孩子，也不画空壳行
  assert.deepEqual(treeRows(tree).map(row => row.name), ['src', 'README.md']);
  assert.equal(treeRows(tree)[0].level, 1);
});

test('treeRows 层级随展开深度递增，折叠的子树不出现', () => {
  const tree = treeWithSrc();
  const rows = treeRows(tree);
  assert.deepEqual(rows.map(row => [row.name, row.level]), [['src', 1], ['main.js', 2], ['README.md', 1]]);
  const collapsed = toggleExpanded(tree, SRC, false);
  assert.deepEqual(treeRows(collapsed).map(row => row.name), ['src', 'README.md']);
});

test('directoryStates 把加载/失败/截断/重列分别报出来，根也在内', () => {
  let tree = emptyTree(ROOT);
  assert.deepEqual(directoryStates(tree)[ROOT], { loading: true }, '已展开但没读的层算 loading');
  tree = applyListing(tree, ROOT, { entries: [entry('a', 'directory')], truncated: true });
  assert.deepEqual(directoryStates(tree)[ROOT], { truncated: true });
  tree = markLoading(tree, ROOT);
  assert.equal(directoryStates(tree)[ROOT].refreshing, true);
  const failed = applyFailure(tree, ROOT, { code: FILE_ERRORS.NOT_FOUND, message: 'x' });
  assert.equal(directoryStates(failed)[ROOT].failure.code, FILE_ERRORS.NOT_FOUND);
});

test('locateFile 找到一路祖先与最终键；路上有一层没读就说 pending', () => {
  const tree = treeWithSrc();
  const hit = locateFile(tree, 'src/main.js');
  assert.equal(hit.current, childPath(SRC, 'main.js'));
  assert.deepEqual(hit.ancestors, [SRC]);
  assert.equal(hit.pending, false);

  const notLoaded = locateFile(emptyTree(ROOT), 'src/main.js');
  assert.equal(notLoaded.current, undefined);
  assert.equal(notLoaded.pending, true, '根还没读，此刻不能断定「文件不存在」');
});

test('locateFile 在重列中的层缺名字时不下结论（pending），列完才说不在', () => {
  let tree = treeWithSrc();
  tree = markLoading(tree, SRC);
  assert.equal(locateFile(tree, 'src/ghost.js').pending, true);
  tree = applyListing(tree, SRC, { entries: [entry('main.js', 'file')] });
  const after = locateFile(tree, 'src/ghost.js');
  assert.equal(after.pending, false);
  assert.equal(after.current, undefined);
});

test('locateFile 区分中间段是目录、最后一段是文件（同名文件不能当目录用）', () => {
  let tree = emptyTree(ROOT);
  tree = applyListing(tree, ROOT, { entries: [entry('src', 'file')] });
  const hit = locateFile(tree, 'src/main.js');
  assert.equal(hit.current, undefined, 'src 是文件，不能当作中间的目录段');
});

test('relativeToRoot 只接受根下的路径；含 . 或 .. 段一律不定位', () => {
  assert.equal(relativeToRoot('C:\\proj\\workspace\\src\\a.js', ROOT), 'src/a.js');
  assert.equal(relativeToRoot('src/a.js', ROOT), 'src/a.js');
  assert.equal(relativeToRoot('/elsewhere/a.js', ROOT), undefined, '绝对但不在根下 → 不定位');
  assert.equal(relativeToRoot('C:\\proj\\workspace\\..\\x.js', ROOT), undefined);
  assert.equal(relativeToRoot('C:\\proj\\workspace\\src\\.\\a.js', ROOT), undefined);
  assert.equal(relativeToRoot(ROOT, ROOT), undefined, '根本身不是文件');
});

test('failureKind 按错误码分类，未知码兜底为 unavailable（保留传输层消息）', () => {
  assert.equal(failureKind({ code: FILE_ERRORS.NOT_FOUND }), 'notFound');
  assert.equal(failureKind({ code: FILE_ERRORS.OUTSIDE }), 'outsideWorkspace');
  assert.equal(failureKind({ code: FILE_ERRORS.NOT_DIRECTORY }), 'notDirectory');
  assert.equal(failureKind({ code: 'gateway/internal' }), 'unavailable');
  assert.equal(failureKind(undefined), 'unavailable');
});
