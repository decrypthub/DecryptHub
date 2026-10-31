import React, { useEffect, useRef, useState } from 'react';
import { Text } from '@radix-ui/themes';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useWorkbench } from './bus.jsx';
import { Button, Icon } from './kit.jsx';
export function TerminalPanel({ tab, active }) {
  const w = useWorkbench(), host = useRef(null), runtime = useRef(null), live = useRef(false), startRef = useRef(null);
  const [status, setStatus] = useState('idle'), [error, setError] = useState('');
  useEffect(() => {
    live.current = true;
    const terminal = new Terminal({ fontFamily: 'Cascadia Code, Consolas, monospace', fontSize: 13, scrollback: 5000, cursorBlink: true, disableStdin: true, allowProposedApi: false });
    const fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(host.current);
    const item = { terminal, fit, status: 'idle', sequence: 0, loading: true, buffered: [] }; runtime.current = item;
    const theme = () => { const light = document.documentElement.getAttribute('data-theme') === 'light'; terminal.options.theme = { background: light ? '#fbfbfc' : '#111113', foreground: light ? '#202124' : '#dfdfe4', cursor: '#e54d2e', selectionBackground: light ? '#dbeafe' : '#354763' }; };
    theme(); const appearance = new MutationObserver(theme); appearance.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const consume = event => { if (event.sequence <= item.sequence) return; item.sequence = event.sequence; terminal.write(event.data); };
    const apply = value => { if (!live.current) return; item.sequence = value.sequence; terminal.reset(); terminal.write(value.output); item.status = value.status; item.loading = false; item.buffered.splice(0).forEach(consume); terminal.options.disableStdin = value.status !== 'running'; setStatus(value.status); };
    const offData = w.api.on('terminal-output', (value, owner) => { if (owner !== w.sid || value.id !== tab.id) return; if (item.loading) item.buffered.push(value); else consume(value); });
    const offExit = w.api.on('terminal-exit', (value, owner) => { if (owner !== w.sid || value.id !== tab.id || !live.current) return; item.status = 'exited'; terminal.options.disableStdin = true; setStatus('exited'); terminal.writeln('\r\n[进程已退出：' + value.exitCode + ']'); });
    const input = terminal.onData(data => { if (item.status === 'running') w.api.invoke('terminal-input', { sessionId: w.sid, id: tab.id, data }).catch(e => live.current && setError(e.message)); });
    const resize = () => { if (!host.current?.offsetWidth || !host.current?.offsetHeight) return; try { fit.fit(); if (item.status === 'running') w.api.invoke('terminal-resize', { sessionId: w.sid, id: tab.id, cols: terminal.cols, rows: terminal.rows }).catch(() => {}); } catch {} };
    const observer = new ResizeObserver(resize); observer.observe(host.current); resize();
    startRef.current = async () => { setError(''); setStatus('starting'); item.loading = true;
      try { const value = await w.api.invoke('terminal-open', { sessionId: w.sid, id: tab.id, cols: terminal.cols, rows: terminal.rows }); apply(value); resize(); if (live.current) terminal.focus(); }
      catch (e) { if (live.current) { item.loading = false; setStatus('idle'); setError(e.message); } }
    };
    if (w.tabs.consumeTerminalStart(tab.id)) startRef.current();
    else w.api.invoke('terminal-snapshot', { sessionId: w.sid, id: tab.id }).then(apply).catch(() => { item.loading = false; });
    return () => { live.current = false; startRef.current = null; input.dispose(); offData(); offExit(); observer.disconnect(); appearance.disconnect(); terminal.dispose(); runtime.current = null; };
  }, [w.sid, tab.id]);
  useEffect(() => { if (!active || !runtime.current) return; try { runtime.current.fit.fit(); } catch {} }, [active]);
  return <section className="terminal-panel" aria-label="交互终端"><div className="bar"><Icon n="terminal" /><Text size="1">本机终端</Text><Text size="1" color="gray">{status === 'running' ? '当前用户权限' : status === 'starting' ? '正在启动…' : status === 'exited' ? '已退出' : '未启动'}</Text><span className="spacer" />{status !== 'running' && <Button size="1" variant="soft" color="gray" disabled={status === 'starting'} onClick={() => startRef.current?.()}>{status === 'exited' ? '重新启动' : '启动终端'}</Button>}</div>{error && <Text as="p" className="terminal-error" size="1" color="red" role="alert">{error}</Text>}<div className="terminal-screen" ref={host} /></section>;
}
