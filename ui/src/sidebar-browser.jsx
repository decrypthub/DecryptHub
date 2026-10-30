import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { DropdownMenu, Spinner, TextField } from '@radix-ui/themes';
import { useWorkbench } from './bus.jsx';
import { ActionIcon, Icon } from './kit.jsx';
import { ProjectTree } from './project-tree.jsx';
import { readSidebarView, sidebarResults } from './sidebar-model.js';

function MatchText({ text, query }) {
  // Plain React text; a query can never become markup or a regular expression.
  const term = query.trim(), index = term ? String(text).toLowerCase().indexOf(term.toLowerCase()) : -1;
  return index < 0 ? text : <>{text.slice(0, index)}<mark>{text.slice(index, index + term.length)}</mark>{text.slice(index + term.length)}</>;
}

export function SidebarBrowser({ searchRequest, onSearchHandled, renderSession }) {
  const w = useWorkbench(), input = useRef(null), searchButton = useRef(null), resultsRef = useRef(null), jumped = useRef(null), ids = useId();
  const [expanded, setExpanded] = useState(false), [query, setQuery] = useState(''), [active, setActive] = useState(0);
  const [view, setView] = useState(() => readSidebarView(localStorage)), [reveal, setReveal] = useState(null), [foldRequest, setFoldRequest] = useState(null);
  const [remote, setRemote] = useState({ query: '', matches: [], state: 'idle', skipped: 0 });
  const normalizedQuery = query.trim();
  const results = useMemo(() => normalizedQuery ? sidebarResults(w.projects, w.sessions.sessions, normalizedQuery, remote.query === normalizedQuery ? remote.matches : []) : [], [w.projects, w.sessions.sessions, normalizedQuery, remote]);
  const selected = Math.min(active, Math.max(0, results.length - 1));
  const pending = !!normalizedQuery && (remote.query !== normalizedQuery || remote.state === 'loading');
  const changeView = patch => setView(current => { const next = { ...current, ...patch }; try { localStorage.setItem('wdh_sidebar_view', JSON.stringify(next)); } catch {} return next; });
  useEffect(() => { if (searchRequest) { setExpanded(true); requestAnimationFrame(() => { input.current?.focus(); input.current?.select(); onSearchHandled?.(); }); } }, [searchRequest]);
  useEffect(() => {
    if (!normalizedQuery) { setRemote({ query: '', matches: [], state: 'idle', skipped: 0 }); return; }
    let live = true;
    const timer = setTimeout(() => {
      setRemote({ query: normalizedQuery, matches: [], state: 'loading', skipped: 0 });
      w.api.invoke('session-search', { query: normalizedQuery }).then(value => { if (live) setRemote({ query: normalizedQuery, matches: value.matches, skipped: value.skipped, state: 'ready' }); }).catch(() => { if (live) setRemote({ query: normalizedQuery, matches: [], skipped: 0, state: 'error' }); });
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [normalizedQuery]);
  useEffect(() => { resultsRef.current?.querySelectorAll('[role="option"]')[selected]?.scrollIntoView({ block: 'nearest' }); }, [selected]);
  useEffect(() => {
    if (!reveal?.turnId || reveal.sessionId !== w.sid || jumped.current === reveal.nonce || w.view !== 'chat') return;
    const frame = requestAnimationFrame(() => {
      const scroll = w.refs.chatRef.current, node = [...(scroll?.querySelectorAll('[data-turn-id]') || [])].find(el => el.dataset.turnId === reveal.turnId);
      if (node) { jumped.current = reveal.nonce; scroll.scrollTo({ top: node.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop - 12, behavior: 'instant' }); }
    });
    return () => cancelAnimationFrame(frame);
  }, [reveal, w.sid, w.cur.events, w.view]);
  const clear = () => { setQuery(''); setActive(0); setExpanded(false); setReveal(null); requestAnimationFrame(() => searchButton.current?.focus()); };
  const choose = result => {
    if (!result) return;
    setQuery(''); setExpanded(false); setActive(0);
    setReveal({ projectId: result.project.id, sessionId: result.kind === 'session' ? result.id : null, turnId: result.turnId, nonce: Date.now() });
    w.setProjectFilter(result.project.id);
    if (result.kind === 'session') w.focusSession(result.id);
  };
  const key = event => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); clear(); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); if (results.length) { const next = (selected + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length; setActive(next); if (event.target !== input.current) resultsRef.current?.querySelectorAll('[role="option"]')[next]?.focus(); } }
    if (event.key === 'Enter' && event.target === input.current) { event.preventDefault(); choose(results[selected]); }
  };
  return <>
    <div className={'rail-sec sidebar-browser-head' + (expanded ? ' is-searching' : '')}>
      {expanded ? <TextField.Root className="sidebar-search-field" color="gray" ref={input} value={query} maxLength={500} onChange={event => { setQuery(event.target.value.replaceAll('\0', '')); setActive(0); }} onKeyDown={key}
        onBlur={event => { if (!query && !event.currentTarget.closest('.sidebar-browser-head')?.contains(event.relatedTarget)) setExpanded(false); }}
        role="combobox" aria-label="搜索项目与会话" aria-autocomplete="list" aria-expanded={!!normalizedQuery} aria-controls={normalizedQuery ? ids + '-results' : undefined} aria-activedescendant={results.length ? ids + '-result-' + selected : undefined} placeholder="搜索项目与会话…">
        <TextField.Slot><Icon n="search" size={14} /></TextField.Slot><TextField.Slot side="right"><ActionIcon icon="x" size="1" variant="ghost" color="gray" title="清除搜索" onMouseDown={event => event.preventDefault()} onClick={clear} /></TextField.Slot>
      </TextField.Root> : <><span>{view.group === 'flat' ? '会话' : '项目'}</span><div className="rail-section-actions">
        <ActionIcon ref={searchButton} size="3" m="0" icon="search" variant="soft" color="gray" title="搜索项目与会话" aria-label="搜索项目与会话" aria-keyshortcuts="Control+K Meta+K" onClick={() => { setExpanded(true); requestAnimationFrame(() => input.current?.focus()); }} />
        <DropdownMenu.Root><DropdownMenu.Trigger><ActionIcon size="3" m="0" icon="tool" variant="soft" color="gray" title="项目视图选项" /></DropdownMenu.Trigger><DropdownMenu.Content align="end" data-overlay>
          <DropdownMenu.Label>显示方式</DropdownMenu.Label><DropdownMenu.RadioGroup value={view.group} onValueChange={group => changeView({ group })}><DropdownMenu.RadioItem value="projects">按项目</DropdownMenu.RadioItem><DropdownMenu.RadioItem value="flat">全部会话</DropdownMenu.RadioItem></DropdownMenu.RadioGroup>
          <DropdownMenu.Separator /><DropdownMenu.Label>排序方式</DropdownMenu.Label><DropdownMenu.RadioGroup value={view.sort} onValueChange={sort => changeView({ sort })}><DropdownMenu.RadioItem value="manual">手动排序</DropdownMenu.RadioItem><DropdownMenu.RadioItem value="recent">最近更新</DropdownMenu.RadioItem></DropdownMenu.RadioGroup>
          {view.group === 'projects' && <><DropdownMenu.Separator /><DropdownMenu.Item onSelect={() => setFoldRequest({ closed: false, nonce: Date.now() })}>展开所有项目</DropdownMenu.Item><DropdownMenu.Item onSelect={() => setFoldRequest({ closed: true, nonce: Date.now() })}>收起所有项目</DropdownMenu.Item></>}
        </DropdownMenu.Content></DropdownMenu.Root>
        <ActionIcon size="3" m="0" icon="plus" variant="soft" color="gray" onClick={() => w.setProjectEditor({})} title="新建项目" />
      </div></>}
    </div>
    {normalizedQuery ? <div className="rail-list sidebar-search-list" onKeyDown={key}>
      <div className="session-search-results" id={ids + '-results'} role="listbox" aria-label="项目与会话搜索结果" ref={resultsRef}>
        {results.map((result, index) => <button type="button" className={'sidebar-search-result' + (selected === index ? ' selected' : '')} role="option" aria-selected={selected === index} key={result.key} id={ids + '-result-' + index} data-result-kind={result.kind} data-result-id={result.id} onFocus={() => setActive(index)} onMouseEnter={() => setActive(index)} onClick={() => choose(result)}>
          <span className="sidebar-result-heading"><Icon n={result.kind === 'project' ? 'folder' : 'chat'} size={14} /><strong><MatchText text={result.title} query={normalizedQuery} /></strong>{result.kind === 'project' && <small>项目</small>}</span>
          <span className="sidebar-result-meta" title={result.subtitle}><MatchText text={result.subtitle} query={normalizedQuery} /></span>
          {result.excerpt && <span className="sidebar-result-excerpt"><MatchText text={result.excerpt} query={normalizedQuery} /></span>}
        </button>)}
      </div>
      <div className="sidebar-search-status" role="status">{pending ? <><Spinner size="1" />正在搜索会话内容…</> : remote.state === 'error' ? '内容搜索暂不可用，仍可按项目和会话名称查找。' : !results.length ? '未找到项目或会话' : `${results.length} 项结果${remote.skipped ? ` · ${remote.skipped} 条记录未能搜索` : ''}`}</div>
    </div> : <ProjectTree view={view} reveal={reveal} foldRequest={foldRequest}>{renderSession}</ProjectTree>}
  </>;
}
