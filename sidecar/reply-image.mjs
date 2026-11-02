// 让模型能在回复里插图：把工作区/附件里的图片登记成「回复图片」，UI 用现成的
// attachment-preview 通道按 id 取 dataUrl 渲染。
//
// 为什么不做成 Markdown 的 ![](data:...)：那条路径会把 base64 写进 .agent-history.json，
// 直接破坏「历史不落 base64」这一既有不变量（见 attachments.test.mjs）。所以历史里
// 只记附件 id，和其他附件走同一套存储、同一套校验。
//
// 安全边界：模型能决定用户屏幕上出现什么图（伪造登录框/系统提示的钓鱼面），
// 因此这里不接受远端 URL、不接受 SVG（可内嵌脚本），一律按文件头真实嗅探格式。
import fs from 'node:fs';
import path from 'node:path';
import { registerAttachment, attachment, inspectImage, MAX_ATTACHMENT_BYTES } from './attachments.mjs';
import { workspacePath } from './workspaces.mjs';

export const MAX_REPLY_IMAGES = 4;

/**
 * 把一张本地图片登记为可展示的回复图片。
 * 只认工作区内的文件，或已经登记过的附件（kind:'attachment'）。
 * @param {string} projectDir 会话数据目录（附件库根）
 * @param {{ path?: string, attachmentId?: string }} input
 * @param {{ ctx?: object, root?: { workRoot?: string } }} opts workRoot 用于解析工作区相对路径
 * @returns {{ id: string, name: string, mime: string, width: number, height: number, bytes: number }}
 */
export function registerReplyImage(projectDir, input, { ctx } = {}) {
  const id = String(input?.attachmentId || '').trim();
  if (id) {
    // 复用已有附件：仍然重新走一遍 attachment() 的哈希校验，不信任调用方给的 id。
    const a = attachment(projectDir, id);
    if (!a.image) throw new Error('该附件不是图片，无法在回复中显示');
    return pick(a);
  }
  const rel = String(input?.path || input?.file || '').trim();
  if (!rel) throw new Error('需要 path（工作区内的图片路径）或 attachmentId');
  if (/^[a-z][\w+.-]*:/i.test(rel)) throw new Error('只支持工作区内的本地图片，不接受网址');
  const file = workspacePath(ctx, rel);
  const st = fs.statSync(file);
  if (!st.isFile()) throw new Error('不是文件：' + rel);
  if (st.size > MAX_ATTACHMENT_BYTES) throw new Error('图片超过 8MB，请先压缩再发送');
  const bytes = fs.readFileSync(file);
  // inspectImage 只按文件头判断：扩展名写成 .png 的 SVG/PDF 会在这里被拒。
  if (!inspectImage(bytes)) throw new Error('不是受支持的图片格式；仅支持 PNG、JPEG、WebP 和静态 GIF');
  return pick(registerAttachment(projectDir, { name: path.basename(file), data: bytes }));
}

function pick(a) {
  return { id: a.id, name: a.label || a.name, mime: a.mime, width: a.width, height: a.height, bytes: a.bytes };
}

/**
 * 工具返回的图片统一收敛成附件引用。
 * 接受的两种形状：
 *   { id, ... }                     —— 已经是附件（reply_image）
 *   { name, data, mime? }           —— 工具当场拿到的 base64（截图、MCP image block）
 * 返回值只含 id 与元信息，base64 在这里就落地成附件，绝不随事件/历史流动。
 */
export function normalizeReplyImages(projectDir, list) {
  const out = [];
  for (const item of (Array.isArray(list) ? list : []).slice(0, MAX_REPLY_IMAGES)) {
    try {
      if (item?.id) { const a = attachment(projectDir, item.id); if (a.image) out.push({ ...pick(a), ...(item.caption ? { caption: String(item.caption).slice(0, 200) } : {}) }); continue; }
      if (typeof item?.data === 'string' && item.data) {
        const a = registerAttachment(projectDir, { name: item.name || '图片', data: item.data, mime: String(item.mime || '') });
        if (a.image) out.push(pick(a));
      }
    } catch { /* 单张坏图不影响同批其他图片，也不该让整次工具调用失败 */ }
  }
  return out;
}

/** 模型在正文里用 ![说明](image:<id>) 指定的位置：只认本会话真实存在的图片附件。 */
export function imageRefIn(projectDir, id) {
  try {
    const key = String(id || '');
    if (!/^[a-f0-9-]{36}$/.test(key)) return null;
    const a = attachment(projectDir, key);
    return a.image ? { id: a.id, name: a.label || a.name } : null;
  } catch { return null; }
}
