import React, { useEffect, useId, useState } from 'react';
import { TextArea } from '@radix-ui/themes';
import { useWorkbench } from './bus.jsx';
import { Button, Icon } from './kit.jsx';
import { useCompositionGuard } from './use-composition-guard.js';
import { isSubmitEnter } from './composition-guard.js';

export function QueuedMessages() {
  const w = useWorkbench(), items = w.cur.queuedItems || [], running = !!w.cur.agentRunning;
  const [expanded, setExpanded] = useState(false), [editing, setEditing] = useState(null), [busy, setBusy] = useState(null);
  const composition = useCompositionGuard(w.sid + ':' + (editing?.id || ''));
  const listId = useId();
  useEffect(() => { if (!items.length) setExpanded(false); if (editing && !items.some(item => item.id === editing.id)) setEditing(null); }, [items, editing?.id]);
  if (!items.length) return null;
  const visible = items.length === 1 || expanded || !!editing || !!busy;
  const act = async (item, channel, extra = {}) => {
    setBusy(item?.id || 'resume');
    try {
      const result = await w.api.invoke(channel, { sessionId: w.sid, id: item?.id, runId: w.cur.run?.id, ...extra });
      if (result?.ok === false) {
        if (!['queue-item-not-found', 'steer-unavailable'].includes(result.code)) w.toast(result.error || '操作失败', 'err');
        return false;
      }
      return true;
    } catch (error) { w.toast(error.message, 'err'); return false; }
    finally { setBusy(null); }
  };
  const save = async () => { if (editing?.text.trim() && await act(editing, 'agent-queue-edit', { text: editing.text })) setEditing(null); };
  const action = (icon, title, onClick, disabled = false) => <button type="button" className="queue-action" aria-label={title} title={title} disabled={!!busy || disabled} onClick={onClick}><Icon n={icon} size={16} /></button>;
  return <section className="queue-dock" aria-label="待发送队列"><div className="queue-panel">
    {items.length > 1 && <button type="button" className="queue-header" aria-controls={listId} aria-expanded={visible} disabled={!!editing || !!busy} onClick={() => setExpanded(value => !value)}><Icon n="layers" size={16} /><span>{items.length} 条排队消息</span><Icon n={visible ? 'chevdown' : 'chevup'} size={14} /></button>}
    <ul className="queue-list" id={listId} hidden={!visible}>{visible && items.map(item => {
      const pending = item.delivery === 'steer';
      return <li className="queue-item" key={item.id}>
        {items.length === 1 && <Icon n="chat" size={16} className="queue-glyph" />}
        {editing?.id === item.id ? <TextArea ref={composition.ref} className="queue-edit" rows={1} value={editing.text} autoFocus aria-label="编辑排队消息" onChange={event => setEditing({ id: item.id, text: event.target.value })} onKeyDown={event => {
          if (composition.isComposing(event)) return;
          if (event.key === 'Escape') { event.preventDefault(); setEditing(null); }
          if (isSubmitEnter(event)) { event.preventDefault(); save(); }
        }} /> : <span className="queue-text" title={item.text}>{(item.text || '仅附件').replace(/\s+/g, ' ').trim()}</span>}
        {!!item.attachments && <span className="queue-attachments">{item.attachments} 个附件</span>}
        {pending && <span className="queue-status" role="status">等待插话</span>}
        <div className="queue-actions">{editing?.id === item.id ? <>
          {action('check', '保存排队消息', save, !editing.text.trim())}{action('x', '取消编辑', () => setEditing(null))}
        </> : <>
          {action('edit', '编辑排队消息', () => setEditing({ id: item.id, text: item.text || '' }), pending || !item.text)}
          {action('trash', '删除排队消息', () => act(item, 'agent-queue-remove'), pending)}
          {action('send', running ? '插话发送' : '仅运行中可插话发送', async () => { if (await act(item, 'agent-queue-steer')) w.followSubmission(w.sid); }, pending || !running)}
        </>}</div>
      </li>;
    })}</ul>
    {!running && <div className="queue-resume"><Button size="1" color="gray" variant="ghost" disabled={!!busy} onClick={() => act(null, 'agent-queue-resume')}>继续待发送消息<Icon n="send" size={14} /></Button></div>}
  </div></section>;
}
