import React, { useEffect, useRef, useState } from 'react';
import { Dialog, Flex, Text, Spinner } from '@radix-ui/themes';
import { ActionIcon, Icon } from './kit.jsx';

const previews = new Map();
const previewQueue = []; let decoding = 0;
function schedulePreview(job) {
  return new Promise((resolve, reject) => {
    const next = () => { decoding++; Promise.resolve().then(job).then(resolve, reject).finally(() => { decoding--; previewQueue.shift()?.(); }); };
    if (decoding < 2) next(); else previewQueue.push(next);
  });
}
function cachePreview(key, value) {
  previews.set(key, value); value.catch(() => { if (previews.get(key) === value) previews.delete(key); });
  while (previews.size > 64) previews.delete(previews.keys().next().value);
  return value;
}
async function thumbnail(dataUrl) {
  const img = new Image();
  await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error('图片无法解码')); img.src = dataUrl; });
  const scale = Math.min(1, 320 / Math.max(img.width, img.height)), canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * scale)); canvas.height = Math.max(1, Math.round(img.height * scale));
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height); img.src = '';
  return canvas.toDataURL('image/webp', .85);
}
export function rememberPreview(sessionId, id, dataUrl) {
  return cachePreview(sessionId + ':' + id, schedulePreview(() => thumbnail(dataUrl)));
}

function AttachmentTile({ item, sessionId, invoke, onRemove }) {
  const [src, setSrc] = useState(''), [error, setError] = useState(''), [open, setOpen] = useState(false), [original, setOriginal] = useState('');
  const tile = useRef(null), [visible, setVisible] = useState(false);
  const name = typeof item === 'string' ? item : item.label || item.name || '附件';
  const image = item.image && item.id;
  useEffect(() => {
    if (!image || !tile.current) return;
    const observer = new IntersectionObserver(entries => setVisible(entries.some(e => e.isIntersecting)), { root: tile.current.closest('.msgs'), rootMargin: '200px 0px' });
    observer.observe(tile.current); return () => observer.disconnect();
  }, [sessionId, item.id, image]);
  useEffect(() => {
    if (!image || !visible) { setSrc(''); return; }
    let disposed = false; const key = sessionId + ':' + item.id;
    const promise = previews.get(key) || cachePreview(key, schedulePreview(async () => { if (disposed) throw new Error('Preview cancelled'); const r = await invoke('attachment-preview', { sessionId, id: item.id }); return thumbnail(r.dataUrl); }));
    Promise.resolve(promise).then(v => !disposed && setSrc(v)).catch(() => !disposed && setError('图片已不可用'));
    return () => { disposed = true; };
  }, [sessionId, item.id, image, visible]);
  useEffect(() => {
    if (!open || !image) { setOriginal(''); return; }
    let disposed = false;
    invoke('attachment-preview', { sessionId, id: item.id }).then(r => !disposed && setOriginal(r.dataUrl)).catch(e => !disposed && setError(e.message));
    return () => { disposed = true; };
  }, [open, sessionId, item.id, image]);
  return <Dialog.Root open={open} onOpenChange={setOpen}><div ref={tile} className={'attachment-tile' + (image ? ' is-image' : '')} data-attachment-id={item.id}>
    {image ? <Dialog.Trigger><button className="attachment-image" type="button" aria-label={'预览图片：' + name} title={name}>
      {src ? <img src={src} alt={name} /> : error ? <Icon n="info" /> : <Spinner size="1" />}
    </button></Dialog.Trigger> : <div className="attachment-file"><Icon n="file" /><span className="ellipsis" title={name}>{name}</span></div>}
    {onRemove && <ActionIcon className="attachment-remove" size="1" variant="soft" color="gray" icon="x" onClick={onRemove} title={'移除附件：' + name} />}
    </div>{image && <Dialog.Content className="image-dialog" maxWidth="960px" aria-describedby={undefined} data-overlay onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); } }}>
      <Flex align="center" justify="between" gap="3"><Dialog.Title mb="0" size="3" className="ellipsis">{name}</Dialog.Title><Dialog.Close><ActionIcon icon="x" variant="ghost" color="gray" title="关闭图片预览" /></Dialog.Close></Flex>
      <div className="image-preview">{original ? <img src={original} alt={name} /> : error ? <Text color="red">{error}</Text> : <Spinner />}</div>
    </Dialog.Content>}
  </Dialog.Root>;
}
export function AttachmentTiles({ items = [], sessionId, invoke, onRemove }) {
  if (!items.length) return null;
  return <div className="attachment-tiles">{items.map((item, i) => <AttachmentTile key={item.key || item.id || i} item={item} sessionId={sessionId} invoke={invoke} onRemove={onRemove ? () => onRemove(item.key) : undefined} />)}</div>;
}
