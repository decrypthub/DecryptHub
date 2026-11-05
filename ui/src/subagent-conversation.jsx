import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Flex, Popover, Spinner, Text, TextArea } from '@radix-ui/themes';
import { ActionIcon, Button, Icon, Markdown } from './kit.jsx';
import { useWorkbench } from './bus.jsx';
import { historyEvents } from './conversation.js';
import { sessionLabel } from './state.js';
import { AGENT_STATUS, AgentEntry } from './subagents.jsx';
import { mergeSubagentWindow } from './subagent-history.js';
import { useCompositionGuard } from './use-composition-guard.js';
import { isSubmitEnter } from './composition-guard.js';

export function SubagentConversation({ path, onNavigate, renderTool }) {
  const w = useWorkbench(), [value, setValue] = useState(null), [error, setError] = useState(''), [loadError, setLoadError] = useState(''), [draft, setDraft] = useState(''), [sending, setSending] = useState(false), [loadingEarlier, setLoadingEarlier] = useState(false);
  const active = useRef(true), viewport = useRef(null), following = useRef(true), prepend = useRef(null);
  const identity = w.sid + ':' + path.join('/');
  const composition = useCompositionGuard(identity);
  useEffect(() => {
    let live = true, timer;
    active.current = true;
    const read = async () => {
      try { const next = await w.api.invoke('subagent-view', { sessionId: w.sid, path }); if (live) { setValue(previous => mergeSubagentWindow(previous, next)); setLoadError(''); } }
      catch (e) { if (live) setLoadError(e.message); }
      if (live) timer = setTimeout(read, 800);
    };
    read();
    return () => { live = false; active.current = false; clearTimeout(timer); };
  }, [identity, w.api]);
  const events = useMemo(() => value ? historyEvents(value.events, value.partial, value.partialItem, value.partialReasoning, value.startSeq) : [], [value]);
  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    if (prepend.current != null) { el.scrollTop += el.scrollHeight - prepend.current; prepend.current = null; }
    else if (following.current) el.scrollTop = el.scrollHeight;
  }, [value]);
  const send = async () => {
    if (!draft.trim() || sending) return;
    const text = draft;
    setSending(true);
    try { await w.api.invoke('subagent-message', { sessionId: w.sid, path, text }); if (active.current) { setDraft(current => current === text ? '' : current); following.current = true; setError(''); } }
    catch (e) { if (active.current) setError(e.message); }
    finally { if (active.current) setSending(false); }
  };
  const earlier = async () => {
    setLoadingEarlier(true);
    try { const older = await w.api.invoke('subagent-view', { sessionId: w.sid, path, beforeSeq: value.startSeq }); if (active.current) { prepend.current = viewport.current?.scrollHeight; setValue(previous => mergeSubagentWindow(previous, older)); } }
    catch (e) { if (active.current) setError(e.message); }
    finally { if (active.current) setLoadingEarlier(false); }
  };
  const agent = value?.agent, running = agent?.status === 'running';
  return <div className="chat subagent-conversation" data-subagent-id={path.at(-1)}>
    <header className="stage-head subagent-header">
      <ActionIcon icon="back" title={path.length > 1 ? '返回上级子代理' : '返回主对话'} onClick={() => onNavigate(path.slice(0, -1))} />
      <button className="subagent-root-link" onClick={() => onNavigate([])}>{sessionLabel(w.session, w.settings.titlePrefix)}</button><Icon n="chevright" size={13} />
      <strong className="ellipsis">{agent?.title || '子代理'}</strong><span className="spacer" /><Text size="1" color="gray">{AGENT_STATUS[agent?.status] || '加载中'}</Text>
      {!!value?.children?.length && <Popover.Root><Popover.Trigger><Button variant="ghost" color="gray" size="2">{value.children.length} 个子代理<Icon n="chevdown" size={12} /></Button></Popover.Trigger><Popover.Content data-overlay width="480px" maxWidth="calc(100vw - 24px)">{value.children.map(child => <AgentEntry key={child.id} agent={child} onOpen={() => onNavigate([...path, child.id])} />)}</Popover.Content></Popover.Root>}
    </header>
    <div className="subagent-transcript" ref={viewport} onClickCapture={event => { if (event.target.closest?.('.tool-head, summary')) following.current = false; }} onScroll={event => { const el = event.currentTarget; following.current = el.scrollHeight - el.clientHeight - el.scrollTop < 48; }}>
      <div className="msgs-in">
        {value?.hasEarlier && <Button variant="ghost" color="gray" size="2" loading={loadingEarlier} onClick={earlier}>加载更早的对话</Button>}
        {!value && !loadError && <Flex gap="2" p="3"><Spinner size="1" /><Text size="2">正在读取子代理对话…</Text></Flex>}
        {events.map((event, index) => {
          const key = event.itemId || event.id || index;
          if (event.type === 'user') return <div key={key} className="msg user"><div className="bubble"><div className="user-content">{event.content.startsWith('你是主代理委派的子代理') ? agent.task : event.content}</div></div></div>;
          if (event.type === 'assistant') return <article key={key} className="msg assistant">{event.reasoning && <details className="subagent-reasoning"><summary>思考过程</summary><Markdown text={event.reasoning} streaming={!event.finished} /></details>}{event.content && <Markdown text={event.content} streaming={!event.finished} />}</article>;
          if (event.type === 'tool') return <div key={key}>{renderTool({ ...event, ...(!running && event.result === undefined ? { cancelled: true, result: '未收到完成结果，未重放该操作。' } : {}) })}</div>;
          if (event.type === 'compact') return <details key={key} className="subagent-reasoning"><summary>上下文已压缩</summary><Markdown text={event.summary} /></details>;
          return null;
        })}
      </div>
    </div>
    <div className="composer-wrap">
      {(error || loadError) && <Text as="p" size="2" color="red" role="alert">{error || loadError}</Text>}
      {agent?.cancelled ? <div className="subagent-readonly">此子代理已取消，历史仍可查看。返回主对话可创建新子代理。</div> : <div className="composer">
        <TextArea ref={composition.ref} className="composer-input" aria-label="向子代理发送消息" placeholder={running ? '向子代理补充要求…' : '继续与子代理对话…'} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (composition.isComposing(event)) return; if (isSubmitEnter(event)) { event.preventDefault(); send(); } }} />
        <div className="composer-bar"><Text size="1" color="gray">独立上下文 · 创建时的权限</Text><span className="spacer" />{running && <ActionIcon icon="stop" title="停止此子代理" onClick={() => w.api.invoke('subagent-stop', { sessionId: w.sid, path }).catch(e => active.current && setError(e.message))} />}<ActionIcon icon="send" title="发送给子代理" variant="solid" disabled={!draft.trim() || sending || !agent} onClick={send} /></div>
      </div>}
    </div>
  </div>;
}
