// 文件树的状态机（纯逻辑，无 JSX、无 DOM、无 React）。
//
// 对齐 DeepSeek Harness `packages/client/ui-sidebar-files/src/client/store.ts` 与
// `FileTree.tsx`：那两处的**全部**关键语义都在这里，界面只负责画。
//
// 为什么必须做成状态机而不是「每个目录一个缓存格子」：
//   · `ready` 层在重新列举期间要保留旧条目（`refreshing`），否则整棵树闪空重绘；
//   · 列举失败时旧条目也要留着，只在下面加一行失败说明；
//   · 某目录重新列举后不再包含某个子目录，必须把它**连同全部后代**从展开集里剪掉，
//     否则用户会一直往一个已不存在的目录里展开；
//   · 折叠要保留已读内容，重新展开立刻出图，不再发请求。
//
// 路径一律用绝对路径做键（界面的 `path` 是展示名，不是键），
// 子路径 = 父路径去掉尾部分隔符后 `/` 接上条目名。

/** 条目类型：DSH `WorkspaceDirectoryEntry.type`。`other` 是既不是文件也不是目录的一切。 */
export const ENTRY_KINDS = ['file', 'directory', 'other'];

/** 一次列举的状态。`refreshing` 只在 `ready` 上出现：清单在手，但正在被重列。 */
export const LISTING = {
  LOADING: 'loading',
  READY: 'ready',
  FAILED: 'failed',
};

/** 已知的失败码，界面按码换文案；其余一律显示传输层自己的消息。 */
export const FILE_ERRORS = {
  NOT_FOUND: 'workspace-file/not-found',
  OUTSIDE: 'workspace-file/outside-workspace',
  NOT_DIRECTORY: 'workspace-file/not-directory',
};

/**
 * 子路径：父路径去掉尾部分隔符后 `/` 接上名字。
 * @param {string} parent - 父目录的绝对路径
 * @param {string} name - 条目名
 * @returns {string}
 */
export function childPath(parent, name) {
  return String(parent).replace(/[/\\]+$/, '') + '/' + name;
}

/**
 * 树根的键：去掉尾部分隔符（`/` 变成空串，`C:\` 变成 `C:`）。
 * @param {string} root - 工作区根目录的绝对路径
 * @returns {string}
 */
export function treeRootOf(root) {
  return String(root || '').replace(/[/\\]+$/, '');
}

/** 一棵新树：根已展开，只有根这一层待读。 */
export function emptyTree(root) {
  return { root, levels: {}, expanded: [root], autoRefresh: true };
}

/**
 * 保证树存在并且根一致。根变了就换一棵树（旧层的键全都失效），
 * 这是 DSH `open()` 里「kept 根不一致就重新 start」的等价物。
 * @param {object|undefined} tree - 现有树
 * @param {string} root - 期望的根
 * @returns {object}
 */
export function ensureTree(tree, root) {
  if (!tree || tree.root !== root) return emptyTree(root);
  return tree;
}

/** 一层开始读：没有清单时置 loading，已有清单时只打 refreshing（条目继续显示）。 */
export function markLoading(tree, path) {
  const level = tree.levels[path];
  const levels = { ...tree.levels };
  if (level?.kind !== LISTING.READY) levels[path] = { kind: LISTING.LOADING };
  else if (level.refreshing !== true) levels[path] = { ...level, refreshing: true };
  return { ...tree, levels };
}

/**
 * 一层读完。
 *
 * 关键的一步在剪枝：重新列举后**不再出现的子目录**，其自身和全部后代的展开态与缓存
 * 一并丢弃（DSH `store.ts` 的 `loaded`）。不做这件事，被删掉的目录会永远留在展开集里，
 * 并且下次「恢复展开态」时还会试图重新展开它。
 * @param {object} tree - 当前树
 * @param {string} path - 刚读完的目录
 * @param {{ entries: Array<object>, truncated?: boolean }} listing - 列举结果
 * @returns {object}
 */
export function applyListing(tree, path, listing) {
  const previous = tree.levels[path];
  let { expanded, levels } = tree;
  const entries = Array.isArray(listing?.entries) ? listing.entries : [];

  if (previous?.kind === LISTING.READY) {
    const survived = new Set(entries.filter(entry => entry.type === 'directory').map(entry => entry.name));
    for (const entry of previous.level.entries || []) {
      if (entry.type !== 'directory' || survived.has(entry.name)) continue;
      const gone = childPath(path, entry.name);
      const below = gone + '/';
      expanded = expanded.filter(value => value !== gone && !value.startsWith(below));
      levels = Object.fromEntries(Object.entries(levels)
        .filter(([key]) => key !== gone && !key.startsWith(below)));
    }
  }

  const next = { ...levels };
  // 保留上一次的 truncated 吗？不保留：这次列举的结果整体取代上一次，
  // 否则「上次超限、这次没超限」会永远显示截断提示。
  next[path] = { kind: LISTING.READY, level: { entries, truncated: listing?.truncated === true } };
  return { ...tree, expanded, levels: next };
}

/**
 * 一层读失败。已有清单就留着（只挂 failure），没有清单才是整层失败。
 * 同时清掉它下面所有层的 refreshing 标记 —— 这个目录都没读成，它下面不可能再列出新东西。
 * @param {object} tree - 当前树
 * @param {string} path - 失败的目录
 * @param {{ code?: string, message?: string }} failure - 失败信息
 * @returns {object}
 */
export function applyFailure(tree, path, failure) {
  const level = tree.levels[path];
  const levels = { ...tree.levels };
  levels[path] = level?.kind === LISTING.READY
    ? { kind: LISTING.READY, level: level.level, failure }
    : { kind: LISTING.FAILED, failure };
  const below = String(path).replace(/[/\\]+$/, '') + '/';
  for (const [key, kept] of Object.entries(levels)) {
    if (key === path || !key.startsWith(below) || kept.kind !== LISTING.READY || kept.refreshing !== true) continue;
    levels[key] = kept.failure === undefined
      ? { kind: LISTING.READY, level: kept.level }
      : { kind: LISTING.READY, level: kept.level, failure: kept.failure };
  }
  return { ...tree, levels };
}

/**
 * 开/关一层。折叠**不删缓存**：重新展开时立刻能画，再问一次只是刷新。
 * @param {object} tree - 当前树
 * @param {string} path - 目录绝对路径
 * @param {boolean} [expanded] - 指定目标状态；省略即切换
 * @returns {object}
 */
export function toggleExpanded(tree, path, expanded) {
  const open = tree.expanded.includes(path);
  if (expanded === open) return tree;
  return { ...tree, expanded: open ? tree.expanded.filter(value => value !== path) : [...tree.expanded, path] };
}

/**
 * 把某一层按 DSH 的规则排序（目录优先，再按名字自然序、不区分大小写），
 * 并推导每行的层级与「是否可展开」。
 *
 * DSH 的排序器是 `Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })`，
 * 所以 `file2` 排在 `file10` 前面；这里用同一个配置，避免换成 `localeCompare` 后顺序变了。
 * @param {Array<object>} entries - 一层的条目
 * @returns {Array<object>}
 */
const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
export function orderEntries(entries) {
  return [...(entries || [])].sort((a, b) => {
    const group = Number(b.type === 'directory') - Number(a.type === 'directory');
    return group !== 0 ? group : byName.compare(a.name, b.name);
  });
}

/**
 * 把树展开成要画的扁平行。
 *
 * 与 DSH 的一处有意差异：DSH 的树自己从扁平 `entries` 反推层级、并**补出路径里缺失的父目录**
 * （`levelsOf`）。我们这里每个目录都要单独列举，缺失的父目录本来就不可能出现在
 * `levels` 里 —— 补一个没有列举结果的目录只会画出一个点不开的空壳。
 * 所以这里只在 `levels` 真实存在的层上行走（DSH 的 `Level` + `workspaceDirectories` 同理：
 * 没有列举结果的层在它那里也是 `loading`）。
 * @param {object} tree - 当前树
 * @returns {Array<object>} 每行 `{ path, name, type, size, level, directory }`
 */
export function treeRows(tree) {
  const rows = [];
  const visit = (path, level) => {
    const listing = tree.levels[path];
    if (listing?.kind !== LISTING.READY) return;
    for (const entry of orderEntries(listing.level.entries)) {
      const entryPath = childPath(path, entry.name);
      rows.push({ ...entry, path: entryPath, level, directory: entry.type === 'directory' });
      if (entry.type === 'directory' && tree.expanded.includes(entryPath)) visit(entryPath, level + 1);
    }
  };
  visit(tree.root, 1);
  return rows;
}

/**
 * 把树翻译成 DSH `FileTreeInput.directories` 的等价物：每层的加载/失败/截断状态，
 * 根也在内。界面用它决定「在条目之间插哪几行提示」。
 * @param {object} tree - 当前树
 * @returns {Record<string, object>}
 */
export function directoryStates(tree) {
  const states = {};
  for (const path of tree.expanded) {
    if (!tree.levels[path]) states[path] = { loading: true };
  }
  for (const [path, level] of Object.entries(tree.levels)) {
    if (level.kind === LISTING.LOADING) states[path] = { loading: true };
    else if (level.kind === LISTING.FAILED) states[path] = { failed: true, failure: level.failure };
    else states[path] = {
      ...(level.failure ? { failure: level.failure } : {}),
      ...(level.level.truncated ? { truncated: true } : {}),
      ...(level.refreshing ? { refreshing: true } : {}),
    };
  }
  return states;
}

/**
 * 某个文件在这棵树里到不到得了：一路上的祖先是否都已列出、是否都包含下一段名字。
 *
 * 这是「标出当前打开的文件并把它滚进视野」的前置判断（DSH `locateFile`）。
 * `pending` 为真的意思是「先别下结论」：路上有一层还在读，或缺名字但那一层正在重列，
 * 此刻判定「不在」是错的。
 * @param {object} tree - 当前树
 * @param {string} relativePath - 相对根、`/` 分隔的文件路径
 * @returns {{ ancestors: Array<string>, current: string|undefined, pending: boolean }}
 */
export function locateFile(tree, relativePath) {
  const parts = String(relativePath || '').split('/').filter(Boolean);
  const ancestors = [];
  let parent = tree.root;
  for (let index = 0; index < parts.length; index++) {
    const listing = tree.levels[parent];
    if (listing?.kind !== LISTING.READY) {
      return { ancestors, current: undefined, pending: listing === undefined || listing.kind === LISTING.LOADING };
    }
    const wantDirectory = index < parts.length - 1;
    const candidates = (listing.level.entries || [])
      .filter(entry => (wantDirectory ? entry.type === 'directory' : entry.type !== 'directory'));
    const hit = candidates.find(entry => entry.name === parts[index]);
    if (!hit) return { ancestors, current: undefined, pending: listing.refreshing === true };
    const path = childPath(parent, hit.name);
    if (wantDirectory) ancestors.push(path);
    parent = path;
  }
  return { ancestors, current: parent, pending: false };
}

/**
 * 界面要打开的某个文件，相对这棵树的根是什么路径。
 * 绝对路径落在根下才算；不在根下或含 `.` / `..` 段的一律不定位。
 * @param {string} filePath - 文件路径（可能是绝对路径）
 * @param {string} root - 树根
 * @returns {string|undefined}
 */
export function relativeToRoot(filePath, root) {
  const path = String(filePath || '').replace(/\\/g, '/');
  const base = String(root || '').replace(/\\/g, '/').replace(/\/+$/, '');
  let relative = path;
  if (path.startsWith(base + '/')) relative = path.slice(base.length + 1);
  else if (/^(?:[a-z]:\/|\/)/i.test(path)) return undefined; // 绝对路径但不在根下
  if (!relative) return undefined;
  return relative.split('/').some(part => part === '' || part === '.' || part === '..') ? undefined : relative;
}

/**
 * 把一次「按错误码」的失败翻成界面文案的键。
 * 只负责分类，文案本身留在界面（DSH 也是这个分工：`failureLine` 拿 `t`）。
 * @param {{ code?: string }} failure
 * @returns {'notFound'|'outsideWorkspace'|'notDirectory'|'unavailable'}
 */
export function failureKind(failure) {
  switch (failure?.code) {
    case FILE_ERRORS.NOT_FOUND: return 'notFound';
    case FILE_ERRORS.OUTSIDE: return 'outsideWorkspace';
    case FILE_ERRORS.NOT_DIRECTORY: return 'notDirectory';
    default: return 'unavailable';
  }
}
