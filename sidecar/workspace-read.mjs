// Window scanning adapted from DeepSeek Harness tool-fs/src/read-render.ts
// at ce7073d51254c26cd63b22a60835b8f948deb447.
// Copyright (c) 2026 DeepSeek. MIT; see docs/licenses/deepseek-harness-MIT.txt.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';

const version = stat => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
export async function readTextWindow(file, { offset = 1, limit = 2000, signal, verify = () => {} } = {}) {
  if (!Number.isSafeInteger(offset) || offset < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 2000)
    throw Error('offset 必须是正整数，limit 必须是 1–2000 的整数');
  signal?.throwIfAborted(); verify();
  const observed = fs.statSync(file, { bigint: true }), handle = await fs.promises.open(file, 'r');
  try {
    if (version(await handle.stat({ bigint: true })) !== version(observed)) throw Error('读取前文件已变化，请重新读取');
    const digest = crypto.createHash('sha256'), decoder = new StringDecoder('utf8'), lines = [];
    let totalLines = 0, outputBytes = 0, truncatedByBytes = false, buffer = '', first = true;
    const append = segment => { if (buffer.length < 2001) buffer = (buffer + segment).slice(0, 2001); };
    const flush = () => {
      totalLines++; const raw = buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer; buffer = '';
      if (totalLines < offset || lines.length >= limit || truncatedByBytes) return;
      const text = raw.length > 2000 ? raw.slice(0, 2000) + '…（本行已截断至 2000 字符）' : raw;
      const bytes = Buffer.byteLength(text) + (lines.length ? 1 : 0);
      if (outputBytes + bytes > 50 * 1024) { truncatedByBytes = true; return; }
      outputBytes += bytes; lines.push({ number: totalLines, text });
    };
    const scan = chunk => {
      if (first && chunk) { chunk = chunk.replace(/^\uFEFF/, ''); first = false; }
      if (chunk.includes('\0')) throw Error('文件包含二进制 NUL 数据，请使用 binary 或相应格式工具读取');
      let start = 0, at;
      while ((at = chunk.indexOf('\n', start)) !== -1) { append(chunk.slice(start, at)); flush(); start = at + 1; }
      append(chunk.slice(start));
    };
    const chunk = Buffer.alloc(64 * 1024); let position = 0;
    for (;;) {
      signal?.throwIfAborted(); const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
      if (!bytesRead) break;
      position += bytesRead; const bytes = chunk.subarray(0, bytesRead); digest.update(bytes); scan(decoder.write(bytes));
    }
    scan(decoder.end()); if (buffer.length) flush();
    signal?.throwIfAborted(); verify();
    if (version(await handle.stat({ bigint: true })) !== version(observed) || version(fs.statSync(file, { bigint: true })) !== version(observed))
      throw Error('读取期间文件已变化，请重新读取；本次版本不会用于覆盖文件');
    if (offset > totalLines && !(totalLines === 0 && offset === 1)) throw Error(`offset=${offset} 超出范围，文件只有 ${totalLines} 行`);
    return { lines, totalLines, truncatedByBytes, hash: digest.digest('hex'), size: Number(observed.size) };
  } finally { await handle.close(); }
}
