// 右栏「工作区文件」：一棵树 + 一个可调宽、可收起的导航栏。
//
// 逻辑对齐 DeepSeek Harness `packages/client/ui-sidebar-files`：
//   · 状态机在 `file-tree-model.js`（loading/ready/failed + refreshing，逐层）。
//   · 树是受控的：这里拥有数据与展开态，行只负责画。
//   · 失败按错误码分文案，且**保留已显示的行**；截断、空目录各一行说明。
//   · 条目分 `file` / `directory` / `other`；不可打开的文件灰显但列出。
//   · 当前打开的文件用 `aria-current` 标出，并在树就绪后滚进视野。
//   · 展开中的目录挂 `fs.watch`（经 sidecar），变化就地重列，不清空整棵树。
//   · 宽度默认 260、最小 180，可拖可键盘调；Escape 收起并交还焦点。
//
// 与本仓既有实现的两处有意保留（详见交付说明）：
//   · 方向键 / Home / End 的树内导航。DSH 没有自定义键盘逻辑（纯 Tab 顺序），
//     但这里已存在且更好用，用户明确要求保留；ARIA 角色改成合法的组合。
//   · 多根目录切换：只读附加目录沿用项目授权。
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text } from '@radix-ui/themes';
import { useWorkbench } from './bus.jsx';
import { Button, ActionIcon, Icon, EmptyState, Dropdown } from './kit.jsx';
import { fmtSize } from './state.js';
import {
  emptyTree, ensureTree, markLoading, applyListing, applyFailure, toggleExpanded,
  treeRows, directoryStates, locateFile, relativeToRoot, failureKind, LISTING,
} from './file-tree-model.js';

/** 导航栏宽度：DSH `DEFAULT_NAVIGATOR_WIDTH` / `NAVIGATOR_MINIMUM`。 */
const NAVIGATOR_WIDTH = 260, NAVIGATOR_MIN = 180, NAVIGATOR_MAX = 520, NAVIGATOR_STEP = 20;
const WIDTH_KEY = 'wdh_files_navigator_width';

const readWidth = () => {
  try { const value = Number(localStorage.getItem(WIDTH_KEY)); return Number.isFinite(value) ? Math.min(NAVIGATOR_MAX, Math.max(NAVIGATOR_MIN, value)) : NAVIGATOR_WIDTH; }
  catch { return NAVIGATOR_WIDTH; }
};

/** 失败行文案：按错误码分别说，未知码保留传输层自己的消息（DSH `failureLine`）。 */
function failureText(failure) {
  switch (failureKind(failure)) {
    case 'notFound': return '这个目录不在了，可能已被移动或删除。';
    case 'outsideWorkspace': return '这个目录在工作区之外，不会读取它。';
    case 'notDirectory': return '这不是一个目录。';
    default: return '读取失败：' + (failure?.message || '未知原因');
  }
}

export function WorkspaceFiles() {
  const w = useWorkbench(), { api, sid, session, cur, toast, addAtt } = w;
  const [rootId, setRootId] = useState('primary');
  const [tree, setTree] = useState(null);
  const [width, setWidth] = useState(readWidth);
  const [hidden, setHidden] = useState(false);
  const [focusPath, setFocusPath] = useState('');
  const [selected, setSelected] = useState(null), [content, setContent] = useState('');

  const ws = session?.workspace;
  // 多根目录时，每个根各有一棵树：根的键就是它的绝对路径。
  const rootPath = rootId === 'primary' ? ws?.root : ws?.roots?.find(r => r.id === rootId)?.root || ws?.root;
  const identity = `${sid}:${ws?.id}:${ws?.revision}:${ws?.projectRevision}:${rootPath}`;
  const epoch = useRef(0), reading = useRef(0), inFlight = useRef(new Set()), navigator = useRef(null), toggleRef = useRef(null);

  const readInvoke = useCallback((path) => api.invoke('workspace-directory', {
    sessionId: sid, path, root: rootId === 'primary' ? undefined : rootId,
  }).then(result => ({ ok: true, value: result })).catch(error => ({ ok: false, error })), [api, sid, rootId]);

  /**
   * 读一层。已有内容时保留，只打 refreshing（DSH 的 `loading` 动作）。
   * `generation` 用来丢弃换会话 / 换根之后晚到的结果。
   */
  const load = useCallback(async (path, generation) => {
    const key = generation + ':' + path;
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    setTree(current => current ? markLoading(current, path) : current);
    const result = await readInvoke(path);
    if (generation === epoch.current) {
      setTree(current => {
        if (!current) return current;
        if (result.ok) return applyListing(current, path, result.value);
        // sidecar 的错误码挂在 Error.code 上，但 WS 只回传 message —— 从 message 里认回来。
        const failure = { code: result.error?.code, message: result.error?.message || '读取失败' };
        return applyFailure(current, path, failure);
      });
    }
    inFlight.current.delete(key);
  }, [readInvoke]);

  /** 重新读取根与所有展开中的层；不重置展开态，也不清空已显示的行。 */
  const refresh = useCallback(() => {
    const generation = ++epoch.current;
    setTree(current => {
      if (!current) return ensureTree(null, rootPath);
      return current;
    });
    const paths = tree?.expanded || [rootPath];
    for (const path of paths) load(path, generation);
  }, [rootPath, tree?.expanded, load]);

  // 换会话 / 换根：整棵树重建（旧层的键全部失效），并把已打开的文件收起来。
  useEffect(() => {
    epoch.current++;
    reading.current++;
    setTree(rootPath ? emptyTree(rootPath) : null);
    setSelected(null); setContent(''); setFocusPath('');
  }, [identity]);

  // 首次有根就开始读根这一层。
  useEffect(() => {
    if (!tree?.root || rootId !== 'primary' && !ws?.roots?.length) return;
    if (tree.levels[tree.root]) return;
    load(tree.root, epoch.current);
  }, [tree?.root, tree?.levels, load, rootId, ws?.roots?.length]);

  // Agent 跑完或有一次文件改动 → 就地刷新（DSH 的自动刷新开关，默认开）。
  useEffect(() => { if (!cur.agentRunning && tree?.root) refresh(); }, [cur.agentRunning, cur.changesVersion]);

  // 目录监听：把「当前展开的绝对路径」整份报给 sidecar，变化时回推要重列的目录。
  useEffect(() => {
    if (!tree?.root) return undefined;
    api.invoke('workspace-watch', { sessionId: sid, paths: tree.expanded }).catch(() => {});
    return api.on('workspace-directory-changed', payload => {
      const generation = epoch.current;
      for (const path of payload?.paths || []) if (tree.expanded.includes(path) || path === tree.root) load(path, generation);
    });
  }, [api, sid, tree?.expanded, tree?.root, load]);

  // 收起导航栏时撤掉监听，避免后台空转。
  useEffect(() => {
    if (!hidden) return undefined;
    api.invoke('workspace-watch', { sessionId: sid, paths: [] }).catch(() => {});
    return undefined;
  }, [api, sid, hidden]);

  const rows = useMemo(() => tree ? treeRows(tree) : [], [tree]);
  const states = useMemo(() => tree ? directoryStates(tree) : {}, [tree]);

  // 当前文件：把已打开的文档路径定位到这棵树里，标出来并滚进视野。
  const currentPath = useMemo(() => {
    if (!tree || !selected?.path) return undefined;
    const relative = relativeToRoot(selected.path, tree.root) ?? selected.path.replace(/\\/g, '/');
    return locateFile(tree, relative).current;
  }, [tree, selected?.path]);
  const currentRef = useRef(null);
  useEffect(() => { currentRef.current?.scrollIntoView({ block: 'nearest' }); }, [currentPath]);

  function open(item) {
    if (item.type === 'other') return;
    if (item.directory) { setTree(current => current ? toggleExpanded(current, item.path) : current); if (!tree?.expanded.includes(item.path)) load(item.path, epoch.current); return; }
    w.tabs.openDocument(item.path, { root: rootId });
    setSelected({ path: item.path });
    setContent('正在读取…');
    const request = ++reading.current;
    const args = { sessionId: sid, root: rootId === 'primary' ? undefined : rootId, file: 'workspace/' + item.path };
    api.invoke('read-file', args)
      .then(value => { if (request === reading.current) setContent(typeof value === 'string' ? value : value.text); })
      .catch(error => { if (request === reading.current) setContent(error.message); });
  }

  function move(path) {
    setFocusPath(path);
    navigator.current?.querySelectorAll('[data-path]').forEach(node => { if (node.dataset.path === path) node.focus(); });
  }

  /** 树内键盘导航：与既有行为一致，但不再假装是 ARIA tree。 */
  function keydown(event, item) {
    const index = rows.findIndex(row => row.path === item.path);
    if (event.key === 'ArrowDown') move(rows[Math.min(rows.length - 1, index + 1)]?.path);
    else if (event.key === 'ArrowUp') move(rows[Math.max(0, index - 1)]?.path);
    else if (event.key === 'Home') move(rows[0]?.path);
    else if (event.key === 'End') move(rows.at(-1)?.path);
    else if (event.key === 'ArrowRight' && item.directory) {
      if (!tree.expanded.includes(item.path)) open(item);
      else if (rows[index + 1]?.level > item.level) move(rows[index + 1].path);
    } else if (event.key === 'ArrowLeft') {
      if (item.directory && tree.expanded.includes(item.path)) open(item);
      else move(item.path.split('/').slice(0, -1).join('/'));
    } else if (event.key === 'Enter' || event.key === ' ') open(item);
    else return;
    event.preventDefault();
  }

  /** Escape 收起导航栏，焦点交给开关（DSH 的 `close`）。 */
  useEffect(() => {
    if (hidden) return undefined;
    const onKey = event => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const box = navigator.current;
      if (!box || !(event.target instanceof Node) || !box.contains(event.target)) return;
      event.preventDefault();
      setHidden(true);
      requestAnimationFrame(() => toggleRef.current?.focus());
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [hidden]);

  const setWidthSafely = useCallback(value => {
    const next = Math.min(NAVIGATOR_MAX, Math.max(NAVIGATOR_MIN, Math.round(value)));
    setWidth(next);
    try { localStorage.setItem(WIDTH_KEY, String(next)); } catch {}
  }, []);

  if (!ws || ws.availability !== 'ready') {
    return <EmptyState icon="folder" title="项目目录不可用" description="重新连接项目目录后可继续浏览文件。">
      <Button size="2" onClick={() => w.setProjectEditor({ ...w.projects.find(p => p.id === w.session?.projectId), relink: true })}>重新选择目录</Button>
    </EmptyState>;
  }

  const rootState = states[tree?.root];
  const rowFor = (item, index) => {
    const isDir = item.type === 'directory';
    const isOther = item.type === 'other';
    const expanded = isDir && tree.expanded.includes(item.path);
    const current = item.path === currentPath;
    const className = 'file-row tree-row' + (current ? ' on' : '') + (isOther ? ' is-other' : '');
    const common = {
      key: item.path,
      type: 'button',
      'data-path': item.path,
      className,
      style: { paddingLeft: 12 + (item.level - 1) * 18 },
      title: isOther ? '这不是文件或目录，无法打开' : item.path,
      tabIndex: focusPath === item.path || (!focusPath && index === 0) ? 0 : -1,
      onFocus: () => setFocusPath(item.path),
      onClick: () => open(item),
      onKeyDown: event => keydown(event, item),
      ...(isDir ? { 'aria-expanded': expanded } : {}),
      ...(current ? { 'aria-current': 'true', ref: currentRef } : {}),
      ...(isOther ? { 'aria-disabled': true } : {}),
    };
    return <React.Fragment key={item.path}>
      <button {...common}>
        <span className="tree-chevron">{isDir && <Icon n={expanded ? 'chevdown' : 'chevright'} size={12} />}</span>
        <Icon n={isDir ? 'folder' : 'file'} size={14} />
        <span className="ellipsis mono">{item.name}</span>
        {!isDir && item.size != null && <span className="num">{fmtSize(item.size)}</span>}
      </button>
      {/* 展开中的目录：加载 / 失败 / 空 / 截断各一行说明，位置与 DSH 的 Level 一致。 */}
      {isDir && expanded && <>
        {states[item.path]?.loading && <Text as="div" size="1" color="gray" className="tree-hint">正在读取…</Text>}
        {states[item.path]?.failure && <div className="tree-hint tree-fail" role="alert">
          <Text size="1">{failureText(states[item.path].failure)}</Text>
          <Button size="1" variant="ghost" onClick={() => load(item.path, epoch.current)}>重试</Button>
        </div>}
        {states[item.path]?.truncated && <Text as="div" size="1" color="gray" className="tree-hint">条目太多，只显示了一部分。</Text>}
      </>}
    </React.Fragment>;
  };

  return <div className="workspace-files">
    <div className="files-header">
      <span className="files-path" title={rootPath}>{rootPath || '项目目录不可用'}</span>
      {selected && <ActionIcon ref={toggleRef} icon="sidebar" variant="soft" color="gray" aria-pressed={!hidden} onClick={() => setHidden(value => !value)} title={hidden ? '显示文件树' : '隐藏文件树'} />}
      <ActionIcon icon="reload" variant="soft" color="gray" onClick={refresh} title="重新读取" />
      <ActionIcon icon="copy" title="复制工作目录路径" onClick={() => navigator.clipboard.writeText(rootPath || '').then(() => toast('工作目录已复制', 'ok')).catch(e => toast(e.message, 'err'))} />
    </div>
    <div className="files-content">
      {ws?.roots?.length > 1 && <div className="project-file-root"><Dropdown label="文件目录" value={rootId} options={ws.roots.map(r => ({ value: r.primary ? 'primary' : r.id, label: r.label + (r.primary ? ' · 主目录' : ' · 只读') }))} onChange={setRootId} /></div>}
      {hidden ? <Text as="p" size="1" color="gray" m="3">文件树已收起。点上方文件夹按钮或按 Esc 可再次显示。</Text> : <div className="file-list workspace-tree" ref={navigator} role="group" aria-label="工作区目录">
        {rootState?.loading && <Text as="p" size="1" color="gray" m="3">正在读取目录…</Text>}
        {rootState?.failure && <div className="tree-fail" role="alert">
          <Text size="1">{failureText(rootState.failure)}</Text>
          <Button size="1" variant="ghost" onClick={() => load(tree.root, epoch.current)}>重试</Button>
        </div>}
        {tree && !rootState?.loading && !rootState?.failure && !rows.length && <EmptyState icon="folder" title="工作区还没有文件" description="Agent 创建的文件会出现在这里。" />}
        {rows.map(rowFor)}
      </div>}
      {/* 宽度调节：可拖，也可用方向键 / Home / End（DSH 的 separator 语义）。 */}
      {!hidden && selected && <div className="tree-width" role="separator" aria-orientation="horizontal" aria-label="调整文件树宽度"
        aria-valuemin={NAVIGATOR_MIN} aria-valuemax={NAVIGATOR_MAX} aria-valuenow={width} tabIndex={0}
        onKeyDown={event => {
          const map = { ArrowUp: width + NAVIGATOR_STEP, ArrowDown: width - NAVIGATOR_STEP, Home: NAVIGATOR_MIN, End: NAVIGATOR_MAX };
          if (!(event.key in map)) return;
          event.preventDefault(); setWidthSafely(map[event.key]);
        }}>
        <div className="tree-width-grip" onPointerDown={event => {
          if (event.button !== 0) return;
          event.preventDefault();
          const startY = event.clientY, startWidth = width;
          const target = event.currentTarget;
          target.setPointerCapture(event.pointerId);
          const moveTo = move => setWidthSafely(startWidth + (move.clientY - startY));
          const stop = () => {
            target.removeEventListener('pointermove', moveTo);
            target.removeEventListener('pointerup', stop);
            target.removeEventListener('lostpointercapture', stop);
          };
          target.addEventListener('pointermove', moveTo);
          target.addEventListener('pointerup', stop);
          target.addEventListener('lostpointercapture', stop);
        }} />
      </div>}
    </div>
    {selected && <div className="detail">
      <div className="detail-head">
        <Text size="1" className="mono ellipsis" style={{ flex: 1 }} title={selected.path}>{selected.path}</Text>
        <Button size="2" variant="soft" color="gray" onClick={() => rootId === 'primary'
          ? addAtt({ key: 'f:' + selected.path, kind: 'file', file: 'workspace/' + selected.path, label: selected.path.split('/').pop() })
          : w.setInput(w.input + '\n请使用 workspace_read 读取项目目录 root=' + rootId + ' 中的 ' + selected.path)}><Icon n="sparkles" size={16} />发给 AI</Button>
        <ActionIcon icon="copy" variant="soft" color="gray" onClick={() => navigator.clipboard.writeText(content).then(() => toast('已复制', 'ok')).catch(e => toast(e.message, 'err'))} title="复制内容" />
        <ActionIcon icon="x" variant="soft" color="gray" onClick={() => { reading.current++; setSelected(null); }} title="关闭文件" />
      </div>
      <pre className="raw" style={{ flex: 1, maxHeight: 'none' }}>{content}</pre>
    </div>}
  </div>;
}
