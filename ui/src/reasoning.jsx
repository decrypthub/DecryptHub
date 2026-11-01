import React, { useState } from 'react';
import { Spinner } from '@radix-ui/themes';
import { Icon, Markdown } from './kit.jsx';

// 思考过程：一行摘要（图标 + 首行内容），展开后在看得到的高度内滚动。
// 与 DeepSeek Harness 一致：不把整段推理摊开，也不让它把页面顶走。
export function Reasoning({ event }) {
  const [open, setOpen] = useState(false);
  const text = String(event.content || '').replace(/\s+/g, ' ').trim();
  return <div className={'reason-row' + (open ? ' is-open' : '')}>
    <button type="button" className="reason-head" aria-expanded={open} onClick={() => setOpen(v => !v)} title={text}>
      <span className="reason-icon">{!event.finished ? <Spinner size="1" /> : <Icon n="sparkles" size={12} />}</span>
      <span className="reason-label">思考</span>
      <span className="reason-preview">{text || (event.finished ? '没有可读内容' : '正在思考…')}</span>
      <Icon n={open ? 'chevup' : 'chevdown'} size={11} className="reason-chev" />
    </button>
    {open && <div className="reasoning-body" tabIndex={0}><Markdown text={event.content} /></div>}
  </div>;
}
