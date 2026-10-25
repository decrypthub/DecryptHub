import React, { useEffect, useRef, useState } from 'react';
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

let win = null;
async function getWin() {
  if (win) return win;
  if (!(window.__TAURI_INTERNALS__ || window.__JSRA_NATIVE)) return null;
  try { const m = await import('@tauri-apps/api/window'); win = m.getCurrentWindow(); return win; } catch { return null; }
}

// 无独立标题栏：窗口按钮浮在内容右上角，拖动交给各栏顶部的 drag region
function WindowControls() {
  const { view, sideOpen, setSideOpen } = useWorkbench();
  const [max, setMax] = useState(false);
  useEffect(() => {
    let off, disposed = false;
    getWin().then(async w => {
      if (!w || disposed) return;
      setMax(await w.isMaximized().catch(() => false));
      const cleanup = await w.onResized(async () => setMax(await w.isMaximized().catch(() => false))).catch(() => null);
      if (disposed) cleanup?.(); else off = cleanup;
    });
    return () => { disposed = true; off?.(); };
  }, []);
  const act = async a => {
    const w = await getWin(); if (!w) return;
    if (a === 'min') w.minimize();
    if (a === 'max') w.toggleMaximize();
    if (a === 'close') w.close();
  };
  return <div className="win-controls">
    {view === 'chat' && <ActionIcon icon="sidebar" className="tool-panel-toggle" variant="soft" color="gray" onClick={() => setSideOpen(value => !value)} title={sideOpen ? '收起工具面板' : '展开工具面板'} aria-pressed={sideOpen} />}
    <ActionIcon icon="minus" onClick={() => act('min')} title="最小化" />
    <ActionIcon icon={max ? 'restore' : 'square'} onClick={() => act('max')} title={max ? '还原' : '最大化'} />
    <ActionIcon icon="x" color="red" onClick={() => act('close')} title="关闭" />
  </div>;
}

function Rail({ onSearch, onCollapse }) {
  const { sessions, sid, focusSession, newSession, closeSession, pinSession, view, setView, api, toast } = useWorkbench();
  const [rename, setRename] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const [menuSession, setMenuSession] = useState(null);
  const list = sessions.sessions || [];
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
    <div className="rail-brand" data-window-drag-region onMouseDown={e => handleWindowDrag(e, native)}>
      <LogoMark size={24} />
      <strong className="rail-name">Decrypt<span className="brand-accent">Hub</span></strong>
      <ActionIcon icon="sidebar" className="rail-collapse" onClick={onCollapse} title="收起会话列表" />
    </div>
    <Button className="new-session" size="2" onClick={newSession} title="新建对话（Ctrl+T）"><Icon n="plus" size={16} /><span>新对话</span><kbd>Ctrl T</kbd></Button>
    <nav className="rail-nav" aria-label="主要导航">
      <NavButton active={view === 'chat'} onClick={() => setView('chat')}><Icon n="dashboard" /><span>Agent 工作台</span></NavButton>
      <NavButton active={view === 'automations'} onClick={() => setView('automations')}><Icon n="clock" /><span>自动化任务</span></NavButton>
    </nav>
    <div className="rail-sec"><span>会话列表</span><span className="rail-count">{list.length}</span><ActionIcon icon="search" variant="soft" color="gray" onClick={onSearch} title="查找会话" /></div>
    <div className="rail-list" aria-label="会话列表">
      {list.map(s => <div key={s.id} data-session-id={s.id} className={'session-item' + (s.id === sid && view === 'chat' ? ' on' : '') + (menuSession === s.id ? ' menu-open' : '')}>
        <button className="session-focus" onClick={() => focusSession(s.id)} onDoubleClick={() => setRename({ id: s.id, title: sessionLabel(s) })} title={s.title} aria-current={s.id === sid && view === 'chat' ? 'page' : undefined}>
          <span className={'session-glyph' + (s.agentRunning ? ' running' : '')} title={s.agentRunning ? '正在分析' : undefined}>{s.agentRunning ? <Spinner size="1" /> : <Icon n="chat" size={16} />}</span>
          <span className="session-text"><strong>{sessionLabel(s)}</strong></span>
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
              <DropdownMenu.Item onSelect={() => pinSession(s.id, !s.pinned)}><Icon n="pin" />{s.pinned ? '取消置顶' : '置顶会话'}</DropdownMenu.Item>
              <DropdownMenu.Separator />
              <DropdownMenu.Item color="red" onSelect={() => closeSession(s.id)}><Icon n="x" />关闭对话</DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </div>
      </div>)}
      {!list.length && <div className="rail-empty"><Icon n="chat" size={22} /><span>从一个新对话开始</span></div>}
    </div>
    <div className="rail-bottom">
      <NavButton className="rail-item" active={view === 'settings'} onClick={() => setView('settings')}><Icon n="settings" /><span className="t">设置</span><kbd>Ctrl ,</kbd></NavButton>
    </div>
    <Dialog.Root open={!!rename} onOpenChange={v => { if (!v && !renaming) setRename(null); }}>
      <Dialog.Content maxWidth="400px"><Dialog.Title>重命名会话</Dialog.Title><Dialog.Description size="2" color="gray">为这次分析起一个容易查找的名字。</Dialog.Description>
        <form onSubmit={commitRename}><TextField.Root mt="4" value={rename?.title || ''} onChange={e => setRename(s => ({ ...s, title: e.target.value }))} autoFocus aria-label="会话名称" /><Flex justify="end" gap="2" mt="4"><Button type="button" variant="soft" color="gray" disabled={renaming} onClick={() => setRename(null)}>取消</Button><Button type="submit" disabled={renaming || !rename?.title.trim()}>{renaming ? '保存中…' : '保存名称'}</Button></Flex></form>
      </Dialog.Content>
    </Dialog.Root>
  </aside>;
}

// 收起时整栏隐藏，展开入口放到对话顶栏最左侧（由 ChatStage 渲染）
function SessionSearch({ open, onOpenChange }) {
  const { sessions, focusSession } = useWorkbench();
  const [q, setQ] = useState('');
  useEffect(() => { if (open) setQ(''); }, [open]);
  const matches = sessions.sessions.filter(s => (sessionLabel(s) + ' ' + (s.url || '')).toLowerCase().includes(q.trim().toLowerCase()));
  const choose = s => { onOpenChange(false); focusSession(s.id); };
  const list = useRef(null);
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Content className="session-search-dialog" maxWidth="560px" onKeyDown={e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); const buttons = [...(list.current?.querySelectorAll('button') || [])];
        if (!buttons.length) return;
        const current = buttons.indexOf(document.activeElement);
        const next = current < 0 ? (e.key === 'ArrowDown' ? 0 : buttons.length - 1) : (current + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }
    }}>
      <Dialog.Title className="sr-only">搜索会话</Dialog.Title><Dialog.Description className="sr-only">按会话名称或网址搜索，方向键选择，回车打开。</Dialog.Description>
      <div className="session-search-input"><TextField.Root size="3" autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="搜索会话…" aria-label="搜索会话" onKeyDown={e => { if (e.key === 'Enter' && matches[0]) choose(matches[0]); }}>
        <TextField.Slot><Icon n="search" size={18} /></TextField.Slot><TextField.Slot side="right"><kbd>ESC</kbd></TextField.Slot>
      </TextField.Root></div>
      <div className="session-search-results" ref={list}>{matches.map(s => <Button size="3" variant="ghost" color="gray" m="0" key={s.id} onClick={() => choose(s)}><Icon n="chat" size={18} /><span>{sessionLabel(s)}</span></Button>)}{!matches.length && <div className="blank-sm">{q.trim() ? '未找到会话' : '暂无会话'}</div>}</div>
    </Dialog.Content>
  </Dialog.Root>;
}

export function Shell() {
  const { settings, view, sideOpen, firstRun } = useWorkbench();
  // 默认聊天优先：侧栏收起，只留一条窄边；用户展开后记住选择
  const [railOpen, setRailOpen] = useState(() => localStorage.getItem('wdh_rail') === 'open');
  const [searchOpen, setSearchOpen] = useState(false);
  const toggleRail = () => setRailOpen(v => { localStorage.setItem('wdh_rail', v ? 'closed' : 'open'); return !v; });
  useEffect(() => {
    const key = e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(v => !v); } };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);
  return <div className="app" data-view={view} data-tools-open={view === 'chat' && sideOpen}>
    <WindowControls />
    {!settings ? <div className="app-loading"><LogoMark size={40} /><Spinner size="2" /><Text size="2" color="gray">正在准备研究工作区…</Text></div> : <>
      <div className="body">
        {railOpen && <Rail onSearch={() => setSearchOpen(true)} onCollapse={toggleRail} />}
        <div className="workspace">
          {view === 'chat' ? <PanelGroup direction="horizontal" autoSaveId="wdh-workbench-layout" className="workbench-panels">
            <Panel id="assistant" order={1} minSize={34} defaultSize={56}><main className="stage"><ChatStage railOpen={railOpen} onExpandRail={toggleRail} /></main></Panel>
            {sideOpen && <><PanelResizeHandle className="resize-handle" title="拖动调整面板宽度" /><Panel id="tools" order={2} minSize={30} defaultSize={44}><aside className="dock" aria-label="分析工具"><Dock /></aside></Panel></>}
          </PanelGroup> : <Screens />}
        </div>
      </div>
      <SessionSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </>}
    {firstRun && <FirstRunDialog />}
  </div>;
}

function FirstRunDialog() {
  const { settings, setFirstRun, setView, api } = useWorkbench();
  const [doc, setDoc] = useState(null);
  const refresh = () => api.invoke('doctor').then(setDoc).catch(() => setDoc({ runtime: { error: '检查失败，请在设置中重试' } }));
  useEffect(() => { refresh(); return api.on('download-progress', p => { if (p.phase === 'done') refresh(); }); }, []);
  const c = settings?.provider === 'anthropic' ? 'anthropic' : 'openai';
  const active = settings?.providers?.find(p => p.id === settings.activeProviderId);
  const keyOk = !!(active?.apiKey || active?.hasKey || settings?.[c]?.apiKey) && !!(active?.baseUrl || settings?.[c]?.baseUrl) && !!(settings?.activeModel || settings?.[c]?.model);
  const ready = keyOk && !doc?.runtime?.error;
  return <Dialog.Root open onOpenChange={v => { if (!v) setFirstRun(false); }}>
    <Dialog.Content className="setup-dialog" maxWidth="520px">
      <div className="setup-brand"><LogoMark size={38} /><span>开始你的第一次任务</span></div>
      <Dialog.Title size="6">让工作区准备就绪。</Dialog.Title>
      <Dialog.Description size="2" color="gray" mb="5">连接一个模型、按需接入 MCP 工具；需要网页证据时再打开目标网站。</Dialog.Description>
      <div className="setup-checks">{[
        ['layers', '运行组件', doc ? !doc.runtime?.error : null, doc?.runtime?.error || '运行环境已准备好'],
        ['globe', '浏览器（可选）', doc ? !!doc.chromeOk : null, doc?.chromeOk ? 'WDH 组件已安装' : '可在设置中安装 WDH；未安装也能先对话和处理文件'],
        ['sparkles', 'AI 模型', keyOk, keyOk ? '已连接模型渠道' : '添加 API Key 以启用 AI 分析'],
      ].map(([icon, title, ok, desc]) => <div className="setup-check" key={title}><span className="setup-check-icon"><Icon n={icon} size={19} /></span><div><strong>{title}</strong><span>{ok === null ? '正在检查…' : desc}</span></div><span className={'setup-state' + (ok ? ' ready' : '')}><Icon n={ok ? 'check' : 'minus'} size={16} /></span></div>)}</div>
      <Flex justify="end" gap="3" mt="5"><Button variant="soft" color="gray" onClick={() => setFirstRun(false)}>稍后</Button><Button onClick={() => { setFirstRun(false); if (!ready) setView('settings'); }}>{ready ? '进入工作台' : '前往设置'}<Icon n="go" size={16} /></Button></Flex>
    </Dialog.Content>
  </Dialog.Root>;
}
