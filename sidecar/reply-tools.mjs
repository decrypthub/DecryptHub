// reply_image：让模型把一张本地图片放进回复里给用户看。
//
// 为什么单独做一个工具而不是让模型写 Markdown 的 ![](data:...)：base64 会进历史、
// 会瞬间吃掉上下文、也会让 .agent-history.json 膨胀几十倍。这里只传附件 id，
// 图片本体留在 .attachments 里，UI 按需取 dataUrl（复用现有 attachment-preview 通道）。
import { object, str } from './contract.mjs';
import { registerReplyImage } from './reply-image.mjs';

async function replyImage(a, ctx) {
  if (!ctx.projectDir) return { text: '当前会话没有可用的附件存储，无法发送图片。', isError: true };
  let ref;
  try {
    ref = registerReplyImage(ctx.projectDir, a, { ctx });
  } catch (e) {
    return { text: '没有发送这张图片：' + (e.message || e), isError: true };
  }
  const caption = String(a.caption || '').trim().slice(0, 200);
  return {
    text: `已发送图片 ${ref.name}（${ref.width}×${ref.height}）${caption ? '，说明：' + caption : ''}。\n`
      + `图片已经展示给用户了。如果需要在正文里指定它出现的位置，就在该处写一行 ![${caption || ref.name}](image:${ref.id})；`
      + `不写也会附在回复末尾，不要重复发送同一张图。`,
    images: [{ ...ref, caption }],
  };
}

export const REPLY_TOOLS = [
  {
    name: 'reply_image',
    description: '把一张图片放进你的回复里给用户看（截图、生成的图表、工作区里已有的图片）。用户能直接看到它，不需要你转述内容。'
      + 'path 是工作区内相对路径，或传 attachmentId 引用用户之前发的附件。仅支持 PNG/JPEG/WebP/静态 GIF，单张不超过 8MB，一次最多 4 张。'
      + '想让图片出现在正文某处时，就在那里单独一行写 ![说明](image:<返回的 id>)；不写则附在回复末尾。不要用 Markdown 直接嵌入 data: 或 http 图片。',
    schema: object({
      path: str('工作区内的图片路径（相对工作目录），例如 captures/login.png'),
      attachmentId: str('可选：引用本会话已有的图片附件 id，优先于 path'),
      caption: str('一句话说明这张图是什么，会显示在图片下方'),
    }),
    run: replyImage,
  },
];
