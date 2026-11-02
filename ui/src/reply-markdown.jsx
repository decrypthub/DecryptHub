// 回复正文里的图片。
//
// 模型可以用 ![说明](image:<附件id>) 指定图片出现在正文的位置，也可以只调 reply_image
// 让图片附在末尾。两条路都收敛到这里渲染：按 id 走 attachment-preview 取 dataUrl，
// 图片本体永远不进 Markdown 字符串、不进 DOM 的 innerHTML、不进历史。
import React, { useMemo } from 'react';
import { Markdown } from './kit.jsx';
import { splitImageRefs } from './image-refs.js';
import { ReplyImages } from './attachments.jsx';

/**
 * @param {{text:string, images?:Array, sessionId:string, invoke:Function, streaming?:boolean}} props
 *   images 来自工具事件（reply_image / take_screenshot），是「没有在正文里指定位置」的那部分。
 */
export function ReplyMarkdown({ text, images = [], sessionId, invoke, streaming = false }) {
  const parts = useMemo(() => splitImageRefs(text), [text]);
  // 正文里已经用 image:<id> 指过位置的图片，不再重复附在末尾。
  const inline = useMemo(() => new Set(parts.filter(p => p.type === 'image').map(p => p.id)), [parts]);
  const trailing = useMemo(() => (images || []).filter(img => img?.id && !inline.has(img.id)), [images, inline]);
  if (!inline.size) {
    return <>
      <Markdown text={text} streaming={streaming} />
      {!!trailing.length && <ReplyImages items={trailing} sessionId={sessionId} invoke={invoke} />}
    </>;
  }
  return <div className="md reply-md">
    {parts.map((part, i) => part.type === 'image'
      ? <ReplyImages key={'img-' + part.id + '-' + i} items={[{ id: part.id, label: part.label }]} sessionId={sessionId} invoke={invoke} />
      : (part.text.trim() ? <Markdown key={'txt-' + i} text={part.text} streaming={streaming} /> : null))}
    {!!trailing.length && <ReplyImages items={trailing} sessionId={sessionId} invoke={invoke} />}
  </div>;
}
