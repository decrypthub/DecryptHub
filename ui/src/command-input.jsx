import React, { forwardRef, useRef } from 'react';
import { TextArea } from '@radix-ui/themes';
import { parseCommand } from './commands.js';

// Keep the native textarea's IME, selection, clipboard and undo behavior.
// Only a recognized leading command receives the editor's command treatment.
export const CommandInput = forwardRef(function CommandInput({ value, skills = [], onScroll, ...props }, ref) {
  const mirror = useRef(null);
  const command = parseCommand(value);
  const prefix = /^\/([a-z0-9][a-z0-9-]*)(?=\s|$)/i.exec(value);
  const token = command?.known || prefix && skills.some(item => item.name === prefix[1]) ? prefix?.[0] : null;
  return <div className="command-input" data-command={token ? prefix[1] : undefined}>
    {token && <div className="command-input-paint" aria-hidden="true"><div ref={mirror}><span className="command-token">{token}</span>{value.slice(token.length)}{'\n'}</div></div>}
    <TextArea {...props} ref={ref} value={value} onScroll={event => {
      if (mirror.current) mirror.current.style.transform = `translate(${-event.currentTarget.scrollLeft}px, ${-event.currentTarget.scrollTop}px)`;
      onScroll?.(event);
    }} />
  </div>;
});
