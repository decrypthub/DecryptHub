import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { atomicJson, resolveIn, isSensitivePath } from './paths.mjs';

export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_ATTACHMENTS = 8;
const ID = /^[a-f0-9-]{36}$/;
const root = dataDir => path.join(dataDir, '.attachments');

export function inspectImage(b) {
  let mime = '', width = 0, height = 0;
  if (b.length >= 24 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && b.toString('ascii', 12, 16) === 'IHDR') {
    mime = 'image/png'; width = b.readUInt32BE(16); height = b.readUInt32BE(20);
  } else if (b.length >= 10 && /^GIF8[79]a$/.test(b.toString('ascii', 0, 6))) {
    if (b.includes(Buffer.from('NETSCAPE2.0'))) throw new Error('请使用静态图片');
    mime = 'image/gif'; width = b.readUInt16LE(6); height = b.readUInt16LE(8);
  } else if (b.length >= 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    mime = 'image/webp'; const kind = b.toString('ascii', 12, 16);
    if (kind === 'VP8X') { if (b[20] & 2) throw new Error('请使用静态图片'); width = b.readUIntLE(24, 3) + 1; height = b.readUIntLE(27, 3) + 1; }
    else if (kind === 'VP8L' && b[20] === 47) { const bits = b.readUInt32LE(21); width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1; }
    else if (kind === 'VP8 ') { width = b.readUInt16LE(26) & 0x3fff; height = b.readUInt16LE(28) & 0x3fff; }
  } else if (b.length >= 4 && b[0] === 255 && b[1] === 216) {
    mime = 'image/jpeg'; let i = 2;
    while (i + 3 < b.length) {
      if (b[i++] !== 255) continue;
      while (b[i] === 255) i++;
      const marker = b[i++]; if (marker === 217 || marker === 218) break;
      if (marker === 1 || marker >= 208 && marker <= 215) continue;
      if (i + 2 > b.length) break;
      const length = b.readUInt16BE(i); if (length < 2 || i + length > b.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 7) { height = b.readUInt16BE(i + 3); width = b.readUInt16BE(i + 5); break; }
      i += length;
    }
  }
  if (!mime) return null;
  if (!width || !height || width * height > 25_000_000 || Math.max(width, height) > 16384) throw new Error('图片尺寸无效或过大，请缩小图片后重试');
  return { mime, width, height };
}

export function registerAttachment(dataDir, { name, data, mime = '' }) {
  const bytes = Buffer.isBuffer(data) ? data : decodeUpload(data);
  if (!bytes.length || bytes.length > MAX_ATTACHMENT_BYTES) throw new Error('每个附件需为 1 字节至 8MB');
  const info = inspectImage(bytes);
  if (!info && (mime.startsWith('image/') || /\.(png|jpe?g|webp|gif|svg|heic|avif|bmp)$/i.test(name || ''))) throw new Error('图片格式无效；支持 PNG、JPEG、WebP 和 GIF');
  if (!info && (bytes.includes(0) || bytes.subarray(0, 4).toString() === '%PDF')) throw new Error('暂不支持此文件格式，请添加文本、代码或图片');
  const id = crypto.randomUUID(), safeName = path.basename(String(name || '附件').replace(/\\/g, '/')).replace(/[\x00-\x1f]/g, '').slice(0, 180) || '附件';
  const dir = resolveIn(root(dataDir), id); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'content'), bytes, { flag: 'wx', mode: 0o600 });
  const meta = { id, name: safeName, label: safeName, bytes: bytes.length, hash: crypto.createHash('sha256').update(bytes).digest('hex'), image: !!info, mime: info?.mime || 'text/plain', ...(info || {}) };
  atomicJson(path.join(dir, 'meta.json'), meta); return meta;
}
function decodeUpload(data) {
  if (typeof data !== 'string' || data.length > Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4) throw new Error('附件数据无效或超过 8MB');
  const bytes = Buffer.from(data, 'base64'); if (bytes.toString('base64') !== data) throw new Error('附件编码无效'); return bytes;
}
export function attachment(dataDir, id) {
  if (!ID.test(String(id))) throw new Error('附件标识无效');
  const dir = resolveIn(root(dataDir), id), file = resolveIn(dir, 'content');
  const meta = JSON.parse(fs.readFileSync(resolveIn(dir, 'meta.json'), 'utf8'));
  const st = fs.statSync(file);
  if (meta.id !== id || st.size !== meta.bytes || meta.bytes > MAX_ATTACHMENT_BYTES || st.nlink > 1 || crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== meta.hash) throw new Error('附件已变化，请重新添加');
  return { ...meta, file };
}
export function attachmentPreview(dataDir, id) {
  const a = attachment(dataDir, id); if (!a.image) throw new Error('附件不是图片');
  return { id, dataUrl: 'data:' + a.mime + ';base64,' + fs.readFileSync(a.file).toString('base64') };
}
export function validateAttachments(dataDir, list = [], { vision = false, workRoot } = {}) {
  if (!Array.isArray(list) || list.length > MAX_ATTACHMENTS) throw new Error('每条消息最多添加 8 个附件');
  let total = 0;
  const out = list.map(input => {
    if (!input || typeof input !== 'object') throw new Error('附件格式无效');
    let a = input;
    if (!['attachment', 'path', 'file', 'page', 'request', 'script', 'snippet'].includes(a.kind)) throw new Error('不支持的附件类型');
    if (a.kind === 'path' || a.kind === 'file') {
      let file;
      if (a.kind === 'path') file = resolveIn(root(dataDir), String(a.path || ''));
      else {
        const name = String(a.file || ''); if (isSensitivePath(name)) throw new Error('不能添加工作区敏感文件');
        file = name.startsWith('workspace/') ? resolveIn(workRoot || path.join(dataDir, 'workspace'), name.slice(10)) : resolveIn(dataDir, name);
      }
      const st = fs.statSync(file); if (!st.isFile() || st.size > MAX_ATTACHMENT_BYTES) throw new Error('附件不是普通文件或超过 8MB');
      a = { kind: 'attachment', ...registerAttachment(dataDir, { name: path.basename(file), data: fs.readFileSync(file) }) };
    }
    if (a.kind !== 'attachment') return a; // Legacy/context attachments keep their own path guards.
    const { file, ...meta } = attachment(dataDir, a.id); total += meta.bytes;
    if (meta.image && !vision) throw new Error('当前模型未启用图片输入，请在模型设置中开启图片能力或切换模型；附件已保留');
    return { kind: 'attachment', ...meta };
  });
  if (total > 20 * 1024 * 1024) throw new Error('每条消息的附件总大小不能超过 20MB');
  return out;
}
export function imageContent(dataDir, ids, vision) {
  return ids.map(id => {
    if (!vision) return { type: 'text', text: '【历史图片未传给当前文字模型】请切换到支持图片的模型后查看。' };
    const a = attachment(dataDir, id);
    if (!a.image) throw new Error('图片附件无效');
    return { type: 'image_url', image_url: { url: attachmentPreview(dataDir, id).dataUrl } };
  });
}
