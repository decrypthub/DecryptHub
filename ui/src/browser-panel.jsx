import React, { useEffect, useState } from 'react';
import { Box, DropdownMenu, Text, TextField, Spinner } from '@radix-ui/themes';
import { ActionIcon, Button, EmptyState, Icon } from './kit.jsx';
import { useWorkbench } from './bus.jsx';
import { hostOf } from './state.js';

export function BrowserPanel() {
  const { cur, inv, go, dispatch, sid, launching, cleanRetry, refs, sendInput, embedOn, embedCovered, setView, toast } = useWorkbench();
  const [component, setComponent] = useState(null), [glowing, setGlowing] = useState(false);
  const running = cur.status.running, active = !!(running && cur.browserActivity?.active);
  useEffect(() => { let live = true; window.api.invoke('component-info').then(value => { if (live) setComponent(value); }).catch(() => {}); return () => { live = false; }; }, []);
  useEffect(() => {
    if (active) { setGlowing(true); return; }
    const timer = setTimeout(() => setGlowing(false), 400);
    return () => clearTimeout(timer);
  }, [active, sid]);
  if (component && (!component.installed || !component.enabled)) return <EmptyState icon="globe" title={component.installed ? '启用 WebDecryptHub' : '安装 WebDecryptHub'} description="添加浏览器组件后，即可浏览网页、抓取请求和调试网站。"><Button variant="soft" onClick={() => setView('plugins')}>管理插件</Button></EmptyState>;
  const illuminated = running && glowing;
  return <>
    <div className="bar browser-bar">
      <ActionIcon icon="back" variant="soft" color="gray" disabled={!running} onClick={() => inv('go-back')} title="后退" />
      <ActionIcon icon="reload" variant="soft" color="gray" disabled={!running} onClick={() => inv('reload')} title="刷新" />
      <Box flexGrow="1" style={{ minWidth: 0 }}>
        <TextField.Root ref={refs.urlRef} size="2" radius="full" value={cur.url} aria-label="目标网址"
          onChange={e => dispatch({ t: 'patch', sid, patch: { url: e.target.value } })}
          onKeyDown={e => e.key === 'Enter' && go()} onFocus={e => e.target.select()}
          placeholder="输入网址，按回车前往（Ctrl+L）" spellCheck={false}><TextField.Slot><Icon n="globe" size={13} /></TextField.Slot>{(launching[sid] || cur.navigating) && <TextField.Slot side="right"><Spinner size="1" /></TextField.Slot>}</TextField.Root>
      </Box>
      <DropdownMenu.Root><DropdownMenu.Trigger><ActionIcon icon="more" variant="soft" color="gray" title="浏览器菜单" /></DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" data-overlay>
          <DropdownMenu.Label>浏览器操作</DropdownMenu.Label>
          <DropdownMenu.Item disabled={!running} onSelect={() => cleanRetry()}><Icon n="broom" />清除当前站点数据并刷新…</DropdownMenu.Item>
          <DropdownMenu.Item disabled={!running} onSelect={() => cleanRetry({ fresh: true })}><Icon n="reload" />使用全新浏览器配置重启…</DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Item disabled={!running} onSelect={() => inv('browser-close').catch(e => toast(e.message, 'err'))}><Icon n="stop" />关闭浏览器（保留会话）</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
    {cur.status.pages.length > 1 && <div className="bar">{cur.status.pages.map(p => <Button key={p.index} size="2" variant={p.active ? 'soft' : 'ghost'} color="gray" onClick={() => inv('select-page', { index: p.index })} title={p.url}>{hostOf(p.url) || '空白页'}</Button>)}</div>}
    {cur.browserError && <div className="browser-error" role="alert"><Icon n="info" size={16} /><span style={{ flex: 1 }}>{cur.browserError}</span><Button size="1" variant="soft" color="red" onClick={() => setView('settings')}>设置</Button></div>}
    {running && cur.debuggerPaused && <div className="browser-control-status"><Icon n="target" size={14} /><Text size="1">已暂停于断点</Text><Box flexGrow="1" /><Button size="1" variant="soft" color="gray" onClick={() => inv('debug-resume').then(r => !r.ok && toast(r.error, 'err')).catch(e => toast(e.message, 'err'))}>恢复网页执行</Button></div>}
    <div className={'screen' + (illuminated ? ' ai-controlled' : '') + (embedOn ? ' native-browser' : '')} aria-label={illuminated ? 'AI 正在操控的浏览器画面' : '浏览器画面'}>
      <div className="browser-viewport" ref={refs.viewRef}>
        {embedOn ? <div className="screen-note"><Text size="1" color="gray">{embedCovered ? '画面已暂时隐藏（关闭浮层后恢复）' : '原生窗口已嵌入'}</Text></div> : running
          ? <canvas ref={refs.canvasRef} className="screen-canvas" tabIndex={0}
            onMouseDown={e => { e.currentTarget.focus(); sendInput(e, 'mouse', { type: 'mousePressed', clickCount: e.detail || 1 }); }}
            onMouseUp={e => sendInput(e, 'mouse', { type: 'mouseReleased', clickCount: e.detail || 1 })}
            onMouseMove={e => sendInput(e, 'mouse', { type: 'mouseMoved' })}
            onWheel={e => sendInput(e, 'wheel', { dx: e.deltaX, dy: e.deltaY })}
            onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && ['l', 't', ','].includes(e.key.toLowerCase())) return; e.preventDefault(); window.api.sendInput({ kind: 'key', type: 'keyDown', key: e.key, code: e.code, text: e.key.length === 1 ? e.key : undefined }); }} />
          : <div className="browser-welcome"><span className="browser-empty-icon"><Icon n="globe" size={28} /></span><h2>打开目标网站</h2><Button size="2" variant="soft" color="gray" onClick={() => { refs.urlRef.current?.focus(); refs.urlRef.current?.select(); }}>输入网址<Icon n="go" size={16} /></Button></div>}
      </div>
      <div className="browser-halo" aria-hidden="true" />
    </div>
  </>;
}
