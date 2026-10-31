import React, { useState } from 'react';
import { Text } from '@radix-ui/themes';
import { useWorkbench } from './bus.jsx';
import { ActionIcon, Icon } from './kit.jsx';

// 参照 DeepSeek Harness 的 QueueDock：只有一条时直接显示那一条（不套摘要头）；
// 多条时默认折叠成「N 条排队消息」，展开后每行才有编辑、删除、立即发送。
export function QueuedMessages() {
  const w = useWorkbench();
  const items = w.cur.queuedItems || [], running = !!w.cur.agentRunning;
  const [open, setOpen] = useState(false), [editing, setEditing] = useState(null);
  if (!items.length) return null;
  const single = items.length === 1, listVisible = single || open;
  const run = (channel, args) => w.inv(channel, args).then(r => { if (r?.ok === false) w.toast(r.error || '操作失败', 'err'); return r; }).catch(e => { w.toast(e.message, 'err'); return { ok: false }; });
  const saveEdit = async () => {
    if (!editing || !editing.text.trim()) return;
    const r = await run('agent-queue-edit', { id: editing.id, text: editing.text });
    if (r?.ok !== false) setEditing(null);
  };
  return <section className={'queue-strip' + (single ? ' is-single' : '')} aria-label="待发送队列">
    {!single && <div className="queue-bar">
      <button type="button" className="queue-open" aria-expanded={open} onClick={() => setOpen(v => !v)}>
        <span className="queue-glyph"><Icon n="layers" size={13} /></span>
        <span className="queue-count">{items.length} 条排队消息</span>
        <span className="spacer" />
        <Icon n={open ? 'chevup' : 'chevdown'} size={12} className="queue-chev" />
      </button>
    </div>}
    {listVisible && <ol className="queue-list">
      {items.map((item, i) => <li className={'queue-item' + (single ? ' is-single' : '')} key={item.id}>
        {single && <span className="queue-glyph"><Icon n="layers" size={13} /></span>}
        {editing?.id === item.id ? <>
          <input className="queue-edit" value={editing.text} autoFocus aria-label="编辑排队消息"
            onChange={e => setEditing({ id: item.id, text: e.target.value })}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); saveEdit(); }
              if (e.key === 'Escape') { e.preventDefault(); setEditing(null); }
            }} />
          <ActionIcon icon="check" size="1" variant="ghost" color="gray" title="保存排队消息" aria-label="保存排队消息" onClick={saveEdit} />
          <ActionIcon icon="x" size="1" variant="ghost" color="gray" title="取消编辑" aria-label="取消编辑" onClick={() => setEditing(null)} />
        </> : <>
          {!single && <span className="queue-index">{i + 1}</span>}
          <span className="queue-text" title={item.text || '附件'}>{item.text || '仅附件'}</span>
          {item.attachments > 0 && <Text size="1" color="gray" className="queue-attachments">{item.attachments} 个附件</Text>}
          <ActionIcon icon="edit" size="1" variant="ghost" color="gray" className="queue-action" title="编辑排队消息" aria-label="编辑排队消息" onClick={() => setEditing({ id: item.id, text: item.text || '' })} />
          <ActionIcon icon="trash" size="1" variant="ghost" color="gray" className="queue-action" title="删除排队消息" aria-label="删除排队消息" onClick={() => run('agent-queue-remove', { id: item.id })} />
          {!running && <ActionIcon icon="send" size="1" variant="ghost" color="gray" className="queue-action" title="立即发送" aria-label="立即发送" onClick={() => run('agent-queue-resume')} />}
        </>}
      </li>)}
    </ol>}
  </section>;
}
