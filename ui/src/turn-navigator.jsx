import React, { useEffect, useId, useRef, useState } from 'react';
import { TURN_PITCH, railWindow, turnPreview, visibleTurnIndex } from './turn-navigation.js';

export function TurnNavigator({ turns, scrollRef }) {
  const rail = useRef(null), hovering = useRef(false), buttons = useRef(new Map());
  const [active, setActive] = useState(0), [preview, setPreview] = useState(null), [focus, setFocus] = useState(null);
  const [window, setWindow] = useState({ start: 0, end: 42 }), [railHeight, setRailHeight] = useState(420), previewId = useId();
  const ids = turns.map(t => t.id).join('\n');
  useEffect(() => {
    const el = scrollRef.current; if (!el) return;
    let offsets = [], frame = 0;
    const update = () => { frame = 0; setActive(visibleTurnIndex(offsets, el.scrollTop, el.clientHeight, el.scrollHeight)); };
    const measure = () => { const top = el.getBoundingClientRect().top; offsets = [...el.querySelectorAll('.conversation-turn')].map(node => node.getBoundingClientRect().top - top + el.scrollTop); setRailHeight(Math.max(0, Math.min(420, el.clientHeight - 40))); update(); };
    const scroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    const observer = new ResizeObserver(measure); observer.observe(el); if (el.firstElementChild) observer.observe(el.firstElementChild);
    el.addEventListener('scroll', scroll, { passive: true }); measure();
    return () => { observer.disconnect(); el.removeEventListener('scroll', scroll); cancelAnimationFrame(frame); };
  }, [ids, scrollRef]);
  useEffect(() => {
    const el = rail.current; if (!el) return;
    const measure = () => setWindow(railWindow(turns.length, el.scrollTop, el.clientHeight));
    const observer = new ResizeObserver(measure); observer.observe(el); el.addEventListener('scroll', measure, { passive: true }); measure();
    return () => { observer.disconnect(); el.removeEventListener('scroll', measure); };
  }, [turns.length]);
  useEffect(() => {
    const el = rail.current; if (!el || hovering.current || focus !== null) return;
    const top = active * TURN_PITCH;
    if (top < el.scrollTop || top + TURN_PITCH > el.scrollTop + el.clientHeight) el.scrollTop = Math.max(0, top - el.clientHeight / 2);
  }, [active, focus]);
  if (turns.length < 2) return null;
  const indices = new Set(Array.from({ length: Math.max(0, window.end - window.start) }, (_, i) => window.start + i));
  indices.add(Math.max(0, active)); if (focus !== null) indices.add(focus);
  const jump = index => {
    const el = scrollRef.current, node = el?.querySelectorAll('.conversation-turn')[index]; if (!node) return;
    el.scrollTo({ top: node.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 12, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  };
  const key = (event, index) => {
    let next;
    if (event.key === 'ArrowDown') next = Math.min(turns.length - 1, index + 1);
    if (event.key === 'ArrowUp') next = Math.max(0, index - 1);
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = turns.length - 1;
    if (event.key === 'Escape') { setPreview(null); return; }
    if (next === undefined) return;
    event.preventDefault(); setFocus(next); rail.current.scrollTop = Math.max(0, next * TURN_PITCH - rail.current.clientHeight / 2);
    requestAnimationFrame(() => buttons.current.get(next)?.focus());
  };
  const selected = turns[preview], text = selected && turnPreview(selected);
  return <nav className="turn-nav" style={{ '--turn-rail-height': railHeight + 'px' }} aria-label="对话轮次索引" onMouseEnter={() => { hovering.current = true; }} onMouseLeave={() => { hovering.current = false; setPreview(focus); }}>
    <div className="turn-nav-scroll" ref={rail}>
      <div className="turn-nav-marks" style={{ height: turns.length * TURN_PITCH }}>
        {[...indices].sort((a, b) => a - b).map(index => turns[index] && <button type="button" className="turn-nav-mark" key={turns[index].id}
          ref={node => { if (node) buttons.current.set(index, node); else buttons.current.delete(index); }} style={{ top: index * TURN_PITCH }}
          tabIndex={index === (focus ?? Math.max(0, active)) ? 0 : -1} aria-label={`第 ${index + 1} 轮：${turnPreview(turns[index]).input}`}
          aria-current={index === active ? 'step' : undefined} aria-describedby={index === preview ? previewId : undefined} data-running={turns[index].active || undefined}
          onMouseEnter={() => setPreview(index)} onFocus={() => { setFocus(index); setPreview(index); }}
          onBlur={() => { setFocus(null); setPreview(null); }} onKeyDown={e => key(e, index)} onClick={() => jump(index)} />)}
      </div>
    </div>
    {text && <div className="turn-nav-preview" role="tooltip" id={previewId}>
      <small>第 {preview + 1} / {turns.length} 轮{selected.active ? ' · 进行中' : ''}</small><strong>{text.input}</strong><p>{text.output}</p>
    </div>}
  </nav>;
}
