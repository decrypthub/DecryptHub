import React, { useEffect, useRef, useState } from 'react';
import { Spinner } from '@radix-ui/themes';
import { Icon, Markdown } from './kit.jsx';

// Only the provider's explicit, readable thinking text is passed to this view.
export function Reasoning({ event }) {
  const [open, setOpen] = useState(true), body = useRef(null), follow = useRef(!event.finished);
  useEffect(() => { const el = body.current; if (el && follow.current && !event.finished) el.scrollTop = el.scrollHeight; }, [event.content, event.finished, open]);
  return <details className="reasoning" open={open} onToggle={e => setOpen(e.currentTarget.open)}>
    <summary><span>{!event.finished ? <Spinner size="1" /> : <Icon n="sparkles" size={14} />}</span><span>思考过程</span><Icon n={open ? 'chevup' : 'chevdown'} size={12} /></summary>
    {open && <div className="reasoning-body" ref={body} tabIndex={0} onScroll={e => { const el = e.currentTarget; follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64; }}><Markdown text={event.content} /></div>}
  </details>;
}
