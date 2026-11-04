// Version bodies are content-addressed objects; metadata never embeds large files.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { resolveIn } from './paths.mjs';
export class ChangeBlobs {
  constructor(root) { this.root = root; }
  put(text) {
    if (text === null) return null;
    const bytes = Buffer.from(text), hash = crypto.createHash('sha256').update(bytes).digest('hex'), file = resolveIn(this.root, hash);
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    try { const fd = fs.openSync(file, 'wx', 0o600); try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
    catch (error) { if (error.code !== 'EEXIST') throw error; this.read(hash, { maxChars: 0 }); }
    return { hash, bytes: bytes.length, lines: text ? text.split('\n').length : 0 };
  }
  read(hash, { offset = 0, maxChars = Infinity } = {}) {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw Error('文件版本标识无效');
    const file = resolveIn(this.root, hash), info = fs.lstatSync(file);
    if (!info.isFile() || info.nlink !== 1) throw Error('文件版本不是独立普通文件');
    const fd = fs.openSync(file, 'r'), digest = crypto.createHash('sha256'), decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    let text = '', totalChars = 0;
    const retain = value => { const begin = Math.max(0, offset - totalChars), count = Math.max(0, maxChars - text.length); text += value.slice(begin, begin + count); totalChars += value.length; };
    try {
      const buffer = Buffer.allocUnsafe(65536); let count;
      while ((count = fs.readSync(fd, buffer)) > 0) { const bytes = buffer.subarray(0, count); digest.update(bytes); retain(decoder.decode(bytes, { stream: true })); }
      retain(decoder.decode());
    } finally { fs.closeSync(fd); }
    if (digest.digest('hex') !== hash) throw Error('保存的文件版本已损坏，拒绝读取或撤销');
    return { text, totalChars, offset, end: offset + text.length, truncated: offset + text.length < totalChars };
  }
}
