import React, { useEffect, useRef, useState } from 'react';

const clamp = value => Math.max(220, Math.min(Number(value) || 272, 480, Math.max(220, window.innerWidth - 560)));
export function useSidebarWidth() {
  const [width, setWidth] = useState(() => { try { return clamp(localStorage.getItem('wdh_rail_width')); } catch { return 272; } });
  useEffect(() => { const resize = () => setWidth(clamp); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }, []);
  const change = value => { const next = clamp(value); setWidth(next); try { localStorage.setItem('wdh_rail_width', String(next)); } catch {} };
  return [width, change];
}

export function SidebarResize({ width, onChange }) {
  const drag = useRef(null);
  const end = event => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); };
  return <div className="rail-resize" role="separator" aria-label="调整左侧栏宽度" aria-orientation="vertical" aria-valuenow={Math.round(width)} aria-valuemin={220} aria-valuemax={480} tabIndex={0}
    onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); drag.current = { x: event.clientX, width }; event.currentTarget.setPointerCapture(event.pointerId); }}
    onPointerMove={event => { if (drag.current) onChange(drag.current.width + event.clientX - drag.current.x); }}
    onPointerUp={end} onPointerCancel={end} onLostPointerCapture={() => { drag.current = null; }} onDoubleClick={() => onChange(272)}
    onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); onChange(width + (event.key === 'ArrowLeft' ? -16 : 16)); } }} />;
}
