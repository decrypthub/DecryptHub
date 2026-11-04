// 一条被截断的输出流：内存里只留尾部，调用方用绝对偏移自己读。
// 消费游标和旁路读取互不影响——连续 read() 不重复，readFrom() 不推进游标。
import fs from 'node:fs';

export class CollectedStream {
  constructor({ maxChars = 80000, spillPath = null } = {}) {
    this.maxChars = maxChars;
    this.spillPath = spillPath || null;
    this.total = 0;
    this.chunks = [];
    this.retained = 0;
    this.truncated = false;
    this.spillBroken = false;
    this.cursor = 0;
  }

  push(chunk) {
    const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk ?? '');
    if (!text) return;
    this.total += text.length;
    this.chunks.push(text);
    this.retained += text.length;
    while (this.retained > this.maxChars && this.chunks.length) {
      const excess = this.retained - this.maxChars;
      if (this.chunks[0].length <= excess) {
        this.retained -= this.chunks.shift().length;
      } else {
        this.chunks[0] = this.chunks[0].slice(excess);
        this.retained -= excess;
      }
      this.truncated = true;
    }
    if (this.spillPath && !this.spillBroken) {
      try { fs.appendFileSync(this.spillPath, text); }
      catch { this.spillBroken = true; }
    }
  }

  get tail() { return this.chunks.join(''); }

  /** 从绝对字符偏移读，不推进消费游标。偏移掉出内存窗口时返回整段尾部并标 lossy。 */
  readFrom(from = 0) {
    const start = Math.max(0, Number(from) || 0);
    const windowStart = this.total - this.retained;
    const spill = this.truncated && this.spillPath && !this.spillBroken ? this.spillPath : undefined;
    if (start < windowStart) return { text: this.tail, nextOffset: this.total, lossy: true, spillPath: spill };
    return { text: this.tail.slice(start - windowStart), nextOffset: this.total, lossy: false, spillPath: spill };
  }

  /** 消费式读取：下次从这次的 nextOffset 继续，不会重复交出同一段。 */
  read() {
    const result = this.readFrom(this.cursor);
    this.cursor = result.nextOffset;
    return result;
  }
}

/** 把 stdout / stderr 两路收成模型看得见的一段增量。两路游标各自前进。 */
export function readProcessOutput(stdout, stderr) {
  const out = stdout?.read?.() || { text: '', lossy: false };
  const err = stderr?.read?.() || { text: '', lossy: false };
  const parts = [];
  if (out.text) parts.push(out.text);
  if (err.text) parts.push('[stderr]\n' + err.text);
  return {
    delta: parts.join('\n'),
    lossy: !!(out.lossy || err.lossy),
    stdoutSpillPath: out.spillPath,
    stderrSpillPath: err.spillPath,
  };
}
