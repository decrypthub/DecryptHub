// 长文本落盘：粘贴的内容超过阈值时，不塞进对话历史，而是写成文件让模型自己读。
//
// 为什么需要这个：用户消息在 UI 里是纯文本直接进 DOM（ui/src/chat.jsx），
// 一条 128 万字符的粘贴会同时撑爆 DOM 布局、每轮 JSON.stringify 落盘和上下文窗口。
// 折叠只能缓解渲染，真正的解法是不让这段文本进入消息体。
//
// 落盘位置在 workRoot 下的 .dh-paste/，而不是会话数据目录：
// workspace_read 的路径守卫（workspaces.mjs 的 workspacePath）把可读范围限死在
// workRoot 内。写到数据目录模型就读不到，只能逼它去用 shell —— 那正是我们要避免的绕道。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { workRoot, workspacePath } from './workspaces.mjs';

/** 超过这个字符数的粘贴内容改为落盘。与 ui/src/paste-drop.js 的阈值必须一致。 */
export const PASTE_LIMIT = 20000;
export const PASTE_DIR = '.dh-paste';
const MAX_BYTES = 8 * 1024 * 1024;

const sanitizeExt = name => {
  const ext = path.extname(String(name || '')).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : '.txt';
};

/**
 * 把一段长文本写成 workRoot 内的文件，返回可被 workspace_read 使用的相对路径。
 * @param ctx 工具上下文（提供 workRoot）
 * @param {string} text 原始文本
 * @param {string} [name] 建议文件名，只取其扩展名
 */
export function savePastedText(ctx, text, name) {
  const body = String(text ?? '');
  const bytes = Buffer.byteLength(body);
  if (!bytes) throw new Error('没有可保存的内容');
  if (bytes > MAX_BYTES) throw new Error(`粘贴内容超过 ${MAX_BYTES / 1024 / 1024}MB，请改为在项目中新建文件后引用`);
  const root = workRoot(ctx);
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const rel = `${PASTE_DIR}/pasted-${stamp}-${crypto.randomBytes(3).toString('hex')}${sanitizeExt(name)}`;
  // 走 workspacePath 而不是直接拼路径：这样符号链接、越界和敏感文件规则仍然生效。
  const target = workspacePath(ctx, rel, { write: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body, { encoding: 'utf8', flag: 'wx' });
  const lines = body.split('\n').length;
  return { path: rel.split(path.sep).join('/'), bytes, lines, chars: body.length };
}

/** 把落盘结果渲染成给模型的一行引用，不含正文。 */
export function pasteNotice(saved) {
  return `【粘贴长文本已存为文件】${saved.path}（${saved.lines} 行 / ${saved.chars} 字符）。`
    + `正文不在对话里；需要时用 workspace_read 读取该路径，超过 30000 字符请用 offset/limit 分段。`;
}
