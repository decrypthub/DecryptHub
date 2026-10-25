import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, Code } from '@radix-ui/themes';
import { useWorkbench } from './bus.jsx';
import { Button, ActionIcon, Icon, EmptyState } from './kit.jsx';
import { fmtSize } from './state.js';

export function WorkspaceFiles() {
  const { api, sid, session, cur, toast, addAtt } = useWorkbench();
  const [branches, setBranches] = useState({}), [expanded, setExpanded] = useState(new Set()), [git, setGit] = useState(null);
  const [selected, setSelected] = useState(null), [content, setContent] = useState(''), [focus, setFocus] = useState('');
  const epoch = useRef(0), reading = useRef(0), tree = useRef(null), inFlight = useRef(new Set());
  const ws = session?.workspace;
  const identity = `${sid}:${ws?.id}:${ws?.revision}:${ws?.root}`;
  async function load(path = '.', generation = epoch.current) {
    const key = generation + ':' + path;
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    setBranches(prev => ({ ...prev, [path]: { ...prev[path], loading: true, error: '' } }));
    try {
      const value = await api.invoke('workspace-directory', { sessionId: sid, path });
      if (generation === epoch.current) setBranches(prev => ({ ...prev, [path]: value }));
    } catch (e) { if (generation === epoch.current) setBranches(prev => ({ ...prev, [path]: { error: e.message } })); }
    finally { inFlight.current.delete(key); }
  }
  function refresh(reset = false) {
    const generation = ++epoch.current;
    setBranches({}); setGit(null);
    if (reset) { reading.current++; setExpanded(new Set()); setSelected(null); setContent(''); setFocus(''); }
    load('.', generation);
    if (!reset) for (const path of expanded) load(path, generation);
    api.invoke('git-status', { sessionId: sid }).then(value => { if (generation === epoch.current) setGit(value); }).catch(() => {});
  }
  useEffect(() => { refresh(true); return () => { epoch.current++; reading.current++; }; }, [identity]);
  useEffect(() => { if (!cur.agentRunning) refresh(); }, [cur.agentRunning, cur.changesVersion]);
  const rows = useMemo(() => {
    const out = [];
    const visit = (path, level) => { for (const item of branches[path]?.entries || []) { out.push({ ...item, level }); if (item.directory && expanded.has(item.path)) visit(item.path, level + 1); } };
    visit('.', 1); return out;
  }, [branches, expanded]);
  function toggle(item) {
    setExpanded(prev => { const next = new Set(prev); next.has(item.path) ? next.delete(item.path) : next.add(item.path); return next; });
    if (!expanded.has(item.path) && !branches[item.path]) load(item.path);
  }
  async function open(path, diff = false) {
    const request = ++reading.current;
    setSelected({ path, diff }); setContent('加载中…');
    try { const value = await api.invoke(diff ? 'git-diff' : 'read-file', { sessionId: sid, ...(diff ? { path } : { file: 'workspace/' + path }) }); if (request === reading.current) setContent(typeof value === 'string' ? value : value.text); }
    catch (e) { if (request === reading.current) setContent(e.message); }
  }
  function move(path) { setFocus(path); tree.current?.querySelectorAll('[role="treeitem"]').forEach(node => { if (node.dataset.path === path) node.focus(); }); }
  function keydown(e, item) {
    const index = rows.findIndex(row => row.path === item.path);
    if (e.key === 'ArrowDown') move(rows[Math.min(rows.length - 1, index + 1)]?.path);
    else if (e.key === 'ArrowUp') move(rows[Math.max(0, index - 1)]?.path);
    else if (e.key === 'Home') move(rows[0]?.path);
    else if (e.key === 'End') move(rows.at(-1)?.path);
    else if (e.key === 'ArrowRight' && item.directory) { if (!expanded.has(item.path)) toggle(item); else if (rows[index + 1]?.level > item.level) move(rows[index + 1].path); }
    else if (e.key === 'ArrowLeft') { if (item.directory && expanded.has(item.path)) toggle(item); else move(item.path.split('/').slice(0, -1).join('/')); }
    else if (e.key === 'Enter' || e.key === ' ') item.directory ? toggle(item) : open(item.path);
    else return;
    e.preventDefault();
  }
  const root = branches['.'];
  return <>
    <div className="bar"><Text size="2" weight="medium">工作区文件</Text><Box flexGrow="1" /><ActionIcon icon="reload" variant="soft" color="gray" onClick={() => refresh()} title="刷新文件目录" /></div>
    <div className="workspace-tree-root" title={ws?.root}><Icon n="folder" size={14} /><Text size="1" className="ellipsis">{ws?.label || '会话工作区'}</Text></div>
    {git?.available && <details className="git-changes"><summary>Git 改动 <Text size="1" color="gray">{git.files.length}</Text></summary>{git.files.map(file => <button className="file-row" key={file.name} onClick={() => open(file.name, true)}><Code>{file.status}</Code><span className="mono ellipsis">{file.name}</span></button>)}</details>}
    <div className="file-list workspace-tree" role="tree" aria-label="工作区目录" ref={tree}>
      {root?.loading && !root.entries && <Text as="p" size="1" color="gray">正在读取目录…</Text>}
      {root?.error && <div role="alert"><Text size="1" color="red">{root.error}</Text><Button size="1" variant="ghost" onClick={() => load()}>重试</Button></div>}
      {root?.entries?.length === 0 && <EmptyState icon="folder" title="工作区还没有文件" description="Agent 创建的文件会出现在这里。" />}
      {rows.map((item, index) => <React.Fragment key={item.path}>
        <button role="treeitem" aria-level={item.level} aria-expanded={item.directory ? expanded.has(item.path) : undefined} aria-selected={selected?.path === item.path} data-path={item.path} tabIndex={focus === item.path || (!rows.some(row => row.path === focus) && index === 0) ? 0 : -1} className={'file-row tree-row' + (selected?.path === item.path ? ' on' : '')} style={{ paddingLeft: 12 + (item.level - 1) * 18 }} title={item.path} onFocus={() => setFocus(item.path)} onClick={() => item.directory ? toggle(item) : open(item.path)} onKeyDown={e => keydown(e, item)}>
          <span className="tree-chevron">{item.directory && <Icon n={expanded.has(item.path) ? 'chevdown' : 'chevright'} size={12} />}</span><Icon n={item.directory ? 'folder' : 'file'} size={14} /><span className="ellipsis mono">{item.name}</span>{!item.directory && <span className="num">{fmtSize(item.size)}</span>}
        </button>
        {item.directory && expanded.has(item.path) && <>
          {branches[item.path]?.loading && <Text as="div" size="1" color="gray" className="tree-hint">正在读取…</Text>}
          {branches[item.path]?.error && <Button size="1" variant="ghost" color="red" onClick={() => load(item.path)}>读取失败，点击重试</Button>}
          {branches[item.path]?.entries?.length === 0 && <Text as="div" size="1" color="gray" className="tree-hint">空文件夹</Text>}
        </>}
      </React.Fragment>)}
      {Object.values(branches).some(branch => branch.truncated) && <Text as="p" size="1" color="gray">单个目录仅展示前 2000 项，可使用 Agent 搜索定位文件。</Text>}
    </div>
    {selected && <div className="detail"><div className="detail-head"><Text size="1" className="mono ellipsis" style={{ flex: 1 }} title={selected.path}>{selected.path}</Text><Button size="2" variant="soft" color="gray" onClick={() => addAtt({ key: 'f:' + selected.path, kind: 'file', file: 'workspace/' + selected.path, label: selected.path.split('/').pop() })}><Icon n="sparkles" size={16} />发给 AI</Button><ActionIcon icon="copy" variant="soft" color="gray" onClick={() => navigator.clipboard.writeText(content).then(() => toast('已复制', 'ok')).catch(e => toast(e.message, 'err'))} title="复制内容" /><ActionIcon icon="x" variant="soft" color="gray" onClick={() => { reading.current++; setSelected(null); }} title="关闭文件" /></div><pre className="raw" style={{ flex: 1, maxHeight: 'none' }}>{content}</pre></div>}
  </>;
}
