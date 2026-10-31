import React, { useEffect, useRef, useState } from 'react';
import { DropdownMenu } from '@radix-ui/themes';
import { ActionIcon, Button, Icon } from './kit.jsx';
import { useWorkbench } from './bus.jsx';
import { orderSidebarSessions } from './sidebar-model.js';

function readFolds() {
  try { return JSON.parse(localStorage.getItem('wdh_project_folds') || '{}') || {}; } catch { return {}; }
}

export function ProjectTree({ children, view = { group: 'projects', sort: 'manual' }, reveal, foldRequest }) {
  const w = useWorkbench();
  const [folds, setFolds] = useState(readFolds), [expanded, setExpanded] = useState({});
  const [drag, setDrag] = useState(null), [drop, setDrop] = useState(null), [busy, setBusy] = useState(false);
  const [menuProject, setMenuProject] = useState(null), root = useRef(null);
  const current = w.session?.projectId, previousSession = useRef(w.sid);
  const setFold = (id, closed) => setFolds(values => {
    const next = { ...values, [id]: closed };
    try { localStorage.setItem('wdh_project_folds', JSON.stringify(next)); } catch {}
    return next;
  });
  useEffect(() => {
    if (previousSession.current !== w.sid || reveal) {
      const changed = previousSession.current !== w.sid;
      previousSession.current = w.sid;
      const target = changed ? current : reveal.projectId;
      if (target) { setFold(target, false); w.setProjectFilter(target); }
      const frame = requestAnimationFrame(() => {
        const sessionId = changed ? w.sid : reveal.sessionId;
        const selector = sessionId ? '[data-session-id]' : '[data-project-id]';
        const node = [...(root.current?.querySelectorAll(selector) || [])].find(el => sessionId ? el.dataset.sessionId === sessionId : el.dataset.projectId === target);
        node?.scrollIntoView({ block: 'nearest' });
        if (!sessionId) node?.querySelector('.project-toggle')?.focus({ preventScroll: true });
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [w.sid, current, reveal]);
  useEffect(() => { if (foldRequest) setFolds(values => { const next = { ...values, ...Object.fromEntries(w.projects.map(p => [p.id, foldRequest.closed])) }; try { localStorage.setItem('wdh_project_folds', JSON.stringify(next)); } catch {} return next; }); }, [foldRequest]);
  const move = async (id, beforeId) => {
    if (busy || id === beforeId) return;
    setBusy(true);
    try { await w.api.invoke('project-move', { id, beforeId }); }
    catch (error) { w.toast('排序失败：' + error.message, 'err'); }
    finally { setBusy(false); setDrag(null); setDrop(null); }
  };
  const ordered = orderSidebarSessions(w.sessions.sessions, view.sort);
  const projects = view.sort === 'recent' ? [...w.projects].sort((a, b) => Math.max(0, ...ordered.filter(s => s.projectId === b.id).map(s => s.updatedAt || 0)) - Math.max(0, ...ordered.filter(s => s.projectId === a.id).map(s => s.updatedAt || 0))) : w.projects;
  return <div className={'rail-list project-tree' + (view.group === 'flat' ? ' is-flat' : '')} aria-label="项目与会话" ref={root} onKeyDown={event => {
    if (!event.target.matches('.project-toggle, .session-focus')) return;
    const nodes = [...root.current.querySelectorAll('.project-toggle, .session-focus')], index = nodes.indexOf(event.target);
    if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) { event.preventDefault(); nodes[event.key === 'Home' ? 0 : event.key === 'End' ? nodes.length - 1 : Math.max(0, Math.min(nodes.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus(); }
    if (event.target.matches('.project-toggle') && ['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); setFold(event.target.closest('[data-project-id]').dataset.projectId, event.key === 'ArrowLeft'); }
  }}>
    {view.group === 'flat' ? ordered.map(s => children(s, true)) : projects.map((project, index) => {
      const sessions = ordered.filter(s => s.projectId === project.id);
      const closed = folds[project.id] === true;
      const watermark = Math.max(5, sessions.findIndex(s => s.id === w.sid || s.id === reveal?.sessionId) + 1, Math.min(50, sessions.findLastIndex(s => s.agentRunning || ['waiting_user', 'waiting_approval'].includes(s.run?.status)) + 1));
      const shown = expanded[project.id] ? sessions : sessions.slice(0, watermark);
      return <section key={project.id} className={'project-group' + (drop?.id === project.id ? ' drop-' + drop.edge : '')} data-project-id={project.id}
        onDragOver={event => {
          if (!drag || busy || view.sort !== 'manual') return;
          event.preventDefault(); event.dataTransfer.dropEffect = 'move';
          const rect = event.currentTarget.getBoundingClientRect();
          setDrop({ id: project.id, edge: event.clientY < rect.top + rect.height / 2 ? 'before' : 'after' });
        }}
        onDrop={event => { event.preventDefault(); if (drag && drop) move(drag, drop.edge === 'before' ? project.id : w.projects[index + 1]?.id ?? null); }}>
          <div className={'project-row' + ((w.projectFilter || current) === project.id ? ' selected' : '') + (menuProject === project.id ? ' menu-open' : '')} draggable={!busy && view.sort === 'manual'} onContextMenu={event => { event.preventDefault(); setMenuProject(project.id); }} onKeyDown={event => { if (event.shiftKey && event.key === 'F10') { event.preventDefault(); setMenuProject(project.id); } }}
          onDragStart={event => { if (busy) { event.preventDefault(); return; } setDrag(project.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', project.id); }}
          onDragEnd={() => { setDrag(null); setDrop(null); }}>
          <button className="project-toggle" aria-expanded={!closed} aria-label={project.name} title={project.folders.map(f => f.root).join('\n')}
            onClick={() => { w.setProjectFilter(project.id); setFold(project.id, !closed); if (!closed) setExpanded(v => ({ ...v, [project.id]: false })); }}>
            <Icon n="folder" size={16} /><span className="ellipsis">{project.name}</span>{project.availability !== 'ready' && <span title="项目目录不可用"><Icon n="info" size={14} /></span>}
          </button>
          <div className="project-actions">
            <DropdownMenu.Root open={menuProject === project.id} onOpenChange={open => setMenuProject(open ? project.id : null)}><DropdownMenu.Trigger><ActionIcon icon="more" title={'项目操作 ' + project.name} /></DropdownMenu.Trigger>
              <DropdownMenu.Content align="end" data-overlay>
                <DropdownMenu.Item onSelect={() => w.setProjectEditor({ ...project, renameOnly: true })}><Icon n="edit" />重命名项目</DropdownMenu.Item>
                <DropdownMenu.Item onSelect={() => w.setProjectEditor(project)}><Icon n="edit" />编辑项目</DropdownMenu.Item>
                <DropdownMenu.Item onSelect={() => w.setProjectEditor({ ...project, relink: true })}><Icon n="folder" />重新选择目录</DropdownMenu.Item>
                <DropdownMenu.Item onSelect={async () => { try { await navigator.clipboard.writeText(project.folders.map(f => f.root).join('\n')); w.toast('项目路径已复制', 'ok'); } catch { w.toast('复制失败', 'err'); } }}><Icon n="copy" />复制项目路径</DropdownMenu.Item>
                <DropdownMenu.Item disabled={index === 0 || busy || view.sort !== 'manual'} onSelect={() => move(project.id, w.projects[index - 1]?.id)}><Icon n="chevup" />上移项目</DropdownMenu.Item>
                <DropdownMenu.Item disabled={index === w.projects.length - 1 || busy || view.sort !== 'manual'} onSelect={() => move(project.id, w.projects[index + 2]?.id ?? null)}><Icon n="chevdown" />下移项目</DropdownMenu.Item>
                <DropdownMenu.Separator />
                <DropdownMenu.Item color="red" onSelect={() => w.setProjectEditor({ ...project, deleting: true })}><Icon n="trash" />删除项目…</DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
            <ActionIcon icon="plus" disabled={project.availability !== 'ready'} title={'在“' + project.name + '”中新建会话'} onClick={() => { setFold(project.id, false); w.newSession(project.id); }} />
          </div>
        </div>
        {!closed && <div className="project-sessions" aria-label={project.name + '的会话'}>
          {shown.map(s => children(s, false))}
          {sessions.length > shown.length && <Button size="1" variant="ghost" color="gray" className="project-show-more" onClick={() => setExpanded(v => ({ ...v, [project.id]: true }))}>展开其余 {sessions.length - shown.length} 个会话</Button>}
          {expanded[project.id] && sessions.length > watermark && <Button size="1" variant="ghost" color="gray" className="project-show-more" onClick={() => setExpanded(v => ({ ...v, [project.id]: false }))}>收起会话</Button>}
          {!sessions.length && <button className="project-empty" disabled={project.availability !== 'ready'} onClick={() => w.newSession(project.id)}>新建第一个会话</button>}
        </div>}
      </section>;
    })}
    {!!w.projects.length && view.group === 'flat' && !ordered.length && <div className="rail-empty">在项目中创建第一个会话</div>}
  </div>;
}
