import { useEffect, useRef, useState } from 'react';
export function useSessionReferences({ input, setInput, inputRef, sid, api, toast }) {
  const [range, setRange] = useState(null), [items, setItems] = useState([]), [selected, setSelected] = useState(0);
  const currentSid = useRef(sid); currentSid.current = sid;
  useEffect(() => { setRange(null); setItems([]); }, [sid]);
  useEffect(() => { if (range && input.slice(range.from, range.to) !== '@' + range.query) { setRange(null); setItems([]); } }, [input, range]);
  useEffect(() => {
    setItems([]); if (!range || !sid) return;
    let active = true;
    const timer = setTimeout(() => {
      api.invoke('session-reference-candidates', { sessionId: sid, query: range.query }).then(records => {
        if (active) setItems(records.map(record => ({ ...record, name: record.sessionId, token: '@', label: record.title, description: record.cwd })));
      }).catch(error => { if (active) toast('无法读取会话引用：' + error.message, 'err'); });
    }, 120);
    return () => { active = false; clearTimeout(timer); };
  }, [sid, range?.query]);
  const update = element => {
    const caret = element.selectionStart ?? element.value.length, prefix = element.value.slice(0, caret);
    const match = /(?:^|\s)@([^\s@\[\]()]{0,80})$/u.exec(prefix);
    const next = match ? { from: caret - match[1].length - 1, to: caret, query: match[1] } : null;
    if (next?.query !== range?.query || next?.from !== range?.from) setSelected(0);
    setRange(next);
  };
  const dismiss = () => { setRange(null); setItems([]); };
  const choose = item => {
    if (!range || input.slice(range.from, range.to) !== '@' + range.query) return;
    const text = input.slice(0, range.from) + item.mention + ' ' + input.slice(range.to), caret = range.from + item.mention.length + 1, target = sid;
    setInput(text); dismiss();
    requestAnimationFrame(() => { if (currentSid.current === target) { inputRef.current?.focus(); inputRef.current?.setSelectionRange(caret, caret); } });
  };
  const onKeyDown = event => {
    if (!range) return false;
    if (event.key === 'Escape') { event.preventDefault(); dismiss(); return true; }
    if (!items.length) return false;
    if (['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); setSelected(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length); return true; }
    if (['Enter', 'Tab'].includes(event.key)) { event.preventDefault(); choose(items[Math.min(selected, items.length - 1)]); return true; }
    return false;
  };
  return { active: !!range, items, selected: Math.min(selected, Math.max(0, items.length - 1)), choose, update, onKeyDown, id: 'session-references-' + sid };
}
