import React, { useEffect, useState } from 'react';
import { Flex, Text, TextField, Spinner, Dialog, DropdownMenu } from '@radix-ui/themes';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useWorkbench } from './bus.jsx';
import { Button, ActionIcon, NavButton, Icon, LogoMark } from './kit.jsx';
import { relTime, sessionLabel } from './state.js';
import { native } from './transport.js';
import { ChatStage } from './chat.jsx';
import { Dock } from './dock.jsx';
import { Screens } from './screens.jsx';
import { handleWindowDrag } from './window-drag.js';
import { ProjectDialogs } from './projects.jsx';
import { readSidebarOpen, saveSidebarOpen } from './sidebar-state.js';
import { SidebarBrowser } from './sidebar-browser.jsx';
import { SidebarResize, useSidebarWidth } from './sidebar-width.jsx';
import { AccountProvider, SidebarAccount } from './account.jsx';
import { OnboardingDialog } from './onboarding.jsx';

let win = null;
async function getWin() {
  if (win) return win;
  if (!(window.__TAURI_INTERNALS__ || window.__JSRA_NATIVE)) return null;
  try { const m = await import('@tauri-apps/api/window'); win = m.getCurrentWindow(); return win; } catch { return null; }
}

// 无独立标题栏：窗口按钮浮在内容右上角，拖动交给各栏顶部的 drag region
function WindowControls({ nativeTitlebar }) {
  const { view, sid, sideOpen, setSideOpen } = useWorkbench();
  const [max, setMax] = useState(false);
  useEffect(() => {
    if (nativeTitlebar) return;
    let off, disposed = false;
    getWin().then(async w => {
      if (!w || disposed) return;
      setMax(await w.isMaximized().catch(() => false));
      const cleanup = await w.onResized(async () => setMax(await w.isMaximized().catch(() => false))).catch(() => null);
      if (disposed) cleanup?.(); else off = cleanup;
    });
    return () => { disposed = true; off?.(); };
  }, [nativeTitlebar]);
  const act = async a => {
    const w = await getWin(); if (!w) return;
    if (a === 'min') w.minimize();
    if (a === 'max') w.toggleMaximize();
    if (a === 'close') w.close();
  };
  if (nativeTitlebar && view !== 'chat') return null;
  return <div className="win-controls">
    {view === 'chat' && <ActionIcon icon="sidebarRight" className="tool-panel-toggle" variant="soft" color="gray" disabled={!sid} onClick={() => setSideOpen(value => !value)} title={sideOpen ? '收起工具面板' : '展开工具面板'} aria-pressed={sideOpen} />}
    {!nativeTitlebar && <>
      <ActionIcon icon="minus" onClick={() => act('min')} title="最小化" />
      <ActionIcon icon={max ? 'restore' : 'square'} onClick={() => act('max')} title={max ? '还原' : '最大化'} />
      <ActionIcon icon="x" color="red" onClick={() => act('close')} title="关闭" />
    </>}
  </div>;
}

function Rail({ searchRequest, onSearchHandled, onCollapse }) {
  const w = useWorkbench();
  const { sessions, sid, focusSession, newSession, closeSession, pinSession, view, setView, api, toast, projects, projectFilter, setProjectFilter, setProjectEditor, setMoveSession } = w;
  const [rename, setRename] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const [menuSession, setMenuSession] = useState(null);
  async function copySession(session, markdown = false) {
    try {
      const text = markdown ? (await api.invoke('session-export-markdown', { sessionId: session.id })).markdown : session.id;
      await navigator.clipboard.writeText(text);
      toast(markdown ? '对话 Markdown 已复制' : '会话 ID 已复制', 'ok');
    } catch (error) { toast('复制失败：' + error.message, 'err'); }
  }
  const commitRename = async e => {
    e.preventDefault();
    if (!rename?.title.trim() || renaming) return;
    setRenaming(true);
    try { await api.invoke('session-rename', { sessionId: rename.id, title: rename.title.trim() }); setRename(null); }
    catch (err) { toast('重命名失败：' + err.message, 'err'); }
    finally { setRenaming(false); }
  };
  return <aside className="rail" aria-label="工作区导航">
    <div className="rail-chrome" data-window-drag-region onMouseDown={e => handleWindowDrag(e, native)}>
      <ActionIcon icon="sidebar" className="rail-collapse" onClick={onCollapse} title="收起会话列表" />
    </div>
    <div className="rail-brand" data-window-drag-region onMouseDown={e => handleWindowDrag(e, native)}>
      <LogoMark size={30} />
      <strong className="rail-name">DecryptHub</strong>
      <span className="rail-badge">AGENT</span>
    </div>
    <Button className="new-session" size="3" variant="surface" color="gray" onClick={newSession} title="新建对话（Ctrl+T）"><Icon n="plus" size={18} /><span>新对话</span><kbd>Ctrl T</kbd></Button>
    <nav className="rail-nav" aria-label="主要导航">
      <NavButton active={view === 'plugins'} onClick={() => setView('plugins')}><Icon n="tool" /><span>插件</span></NavButton>
      <NavButton active={view === 'automations'} onClick={() => setView('automations')}><Icon n="clock" /><span>自动化任务</span></NavButton>
    </nav>
    <SidebarBrowser searchRequest={searchRequest} onSearchHandled={onSearchHandled} renderSession={(s, showProject) => <div key={s.id} data-session-id={s.id} className={'session-item' + (showProject ? ' has-project' : '') + (s.id === sid && view === 'chat' ? ' on' : '') + (menuSession === s.id ? ' menu-open' : '')}
      onContextMenu={event => { event.preventDefault(); setMenuSession(s.id); }} onKeyDown={event => { if (event.shiftKey && event.key === 'F10') { event.preventDefault(); setMenuSession(s.id); } }}>
        <button className="session-focus" onClick={() => focusSession(s.id)} onDoubleClick={() => setRename({ id: s.id, title: sessionLabel(s) })} title={s.title} aria-current={s.id === sid && view === 'chat' ? 'page' : undefined}>
          <span className={'session-glyph' + (s.agentRunning ? ' running' : '')} title={s.agentRunning ? '正在分析' : undefined}>{s.agentRunning ? <Spinner size="1" /> : <Icon n="chat" size={16} />}</span>
          <span className="session-text"><strong>{sessionLabel(s)}</strong>{showProject && <small>{projects.find(p => p.id === s.projectId)?.name}</small>}</span>
          {s.pinned && <span className="session-pin" title="已置顶"><Icon n="pin" size={12} /></span>}
          <span className="session-time">{relTime(s.updatedAt)}</span>
        </button>
        <div className="session-actions">
          <DropdownMenu.Root open={menuSession === s.id} onOpenChange={open => setMenuSession(open ? s.id : null)}>
            <DropdownMenu.Trigger><ActionIcon icon="more" title="会话操作" /></DropdownMenu.Trigger>
            <DropdownMenu.Content align="end" sideOffset={6} size="2" className="session-menu">
              <DropdownMenu.Item onSelect={() => setRename({ id: s.id, title: sessionLabel(s) })}><Icon n="edit" />重命名会话</DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => copySession(s)}><Icon n="copy" />复制会话 ID</DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => copySession(s, true)}><Icon n="report" />复制为 Markdown</DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => setMoveSession(s.id)}><Icon n="folder" />移动到项目…</DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => pinSession(s.id, !s.pinned)}><Icon n="pin" />{s.pinned ? '取消置顶' : '置顶会话'}</DropdownMenu.Item>
              <DropdownMenu.Separator />
              <DropdownMenu.Item color="red" onSelect={() => closeSession(s.id)}><Icon n="trash" />删除对话</DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </div>
      </div>} />
    <div className="rail-bottom">
      <SidebarAccount />
    </div>
    <Dialog.Root open={!!rename} onOpenChange={v => { if (!v && !renaming) setRename(null); }}>
      <Dialog.Content maxWidth="400px"><Dialog.Title>重命名会话</Dialog.Title><Dialog.Description size="2" color="gray">为这次分析起一个容易查找的名字。</Dialog.Description>
        <form onSubmit={commitRename}><TextField.Root mt="4" value={rename?.title || ''} onChange={e => setRename(s => ({ ...s, title: e.target.value }))} autoFocus aria-label="会话名称" /><Flex justify="end" gap="2" mt="4"><Button type="button" variant="soft" color="gray" disabled={renaming} onClick={() => setRename(null)}>取消</Button><Button type="submit" disabled={renaming || !rename?.title.trim()}>{renaming ? '保存中…' : '保存名称'}</Button></Flex></form>
      </Dialog.Content>
    </Dialog.Root>
  </aside>;
}

export function Shell() {
  return <AccountProvider><WorkbenchShell /></AccountProvider>;
}

function WorkbenchShell() {
  const { settings, view, sideOpen, firstRun, sid, panelLayout, setPanelLayout } = useWorkbench();
  const nativeTitlebar = window.__JSRA_NATIVE_TITLEBAR === true;
  // 项目侧栏默认展开；搜索快捷键在收起时展开它。
  const [railOpen, setRailOpen] = useState(() => readSidebarOpen(localStorage));
  const [searchRequest, setSearchRequest] = useState(0);
  const [railWidth, setRailWidth] = useSidebarWidth();
  const toggleRail = () => setRailOpen(value => { saveSidebarOpen(localStorage, !value); return !value; });
  useEffect(() => {
    const key = e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setRailOpen(true); saveSidebarOpen(localStorage, true); setSearchRequest(v => v + 1); } };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);
  return <div className="app" style={{ '--rail-width': railWidth + 'px' }} data-view={view} data-tools-open={view === 'chat' && sideOpen} data-native-titlebar={nativeTitlebar} data-rail-open={railOpen}>
    <WindowControls nativeTitlebar={nativeTitlebar} />
    {!settings ? <div className="app-loading"><LogoMark size={40} /><Spinner size="2" /><Text size="2" color="gray">正在准备研究工作区…</Text></div> : <>
      <div className="body">
        {railOpen && <><Rail searchRequest={searchRequest} onSearchHandled={() => setSearchRequest(0)} onCollapse={toggleRail} /><SidebarResize width={railWidth} onChange={setRailWidth} /></>}
        <div className="workspace">
          {view === 'chat' ? <PanelGroup key={sid} direction="horizontal" onLayout={sizes => setPanelLayout(sizes, sid)} className="workbench-panels">
            <Panel id="assistant" order={1} minSize={34} defaultSize={panelLayout[0]}><main className="stage"><ChatStage railOpen={railOpen} onExpandRail={toggleRail} /></main></Panel>
            {sideOpen && <><PanelResizeHandle className="resize-handle" title="拖动调整面板宽度" /><Panel id="tools" order={2} minSize={30} defaultSize={panelLayout[1]}><aside className="dock" aria-label="分析工具"><Dock /></aside></Panel></>}
          </PanelGroup> : <Screens />}
        </div>
      </div>
      <ProjectDialogs />
    </>}
    {firstRun && <OnboardingDialog />}
  </div>;
}
