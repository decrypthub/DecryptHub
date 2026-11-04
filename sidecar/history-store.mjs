// Host adaptation of DSH JSONL storage/generation contracts. Old generations
// stay immutable after publication of a successor; only the current log appends.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { atomicJson, resolveIn } from './paths.mjs';
import { WriterLease } from './writer-lease.mjs';
import { compressFrame, decompressFrame, decompressPrefix, scanZstdFrames } from './history-zstd.mjs';
import { CURRENT_STORAGE_VERSION, HISTORY_STORAGE_FORMATS } from './history-formats.mjs';
export const HISTORY_STORAGE_VERSION = CURRENT_STORAGE_VERSION;
const FORMAT = 'decrypthub-history-jsonl';
const generationName = /^history-[a-f0-9]{32}\.jsonl(?:\.zst)?$/;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const identity = info => [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(':');
const directory = file => resolveIn(path.dirname(file), '.history');
function ordinary(file) {
  const info = fs.lstatSync(file, { bigint: true });
  if (!info.isFile() || info.nlink !== 1n) throw Error('历史记录不是独立普通文件');
  return info;
}
function marker(file) {
  resolveIn(path.dirname(file), path.basename(file));
  let bytes;
  try { ordinary(file); bytes = fs.readFileSync(file); } catch (error) { if (error.code === 'ENOENT') return { raw: null, bytes: null }; throw error; }
  let raw; try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '')); } catch { throw Error('会话记录无法解析，已停止以保护原文件'); }
  if (raw?.storage !== FORMAT) return { raw, bytes };
  if (!HISTORY_STORAGE_FORMATS.some(format => format.version === raw.v)) throw Error(`历史存储版本 ${raw.v} 无法读取，请使用匹配的新版本`);
  if (!generationName.test(raw.generation || '') || !/^[a-f0-9]{32}$/.test(raw.id || '')) throw Error('历史代际指针无效');
  if ((raw.v === 4) === raw.generation.endsWith('.zst')) throw Error('历史代际编码与版本不匹配');
  return { raw, bytes, generation: resolveIn(directory(file), raw.generation) };
}
export function historyRevision(file) {
  const current = marker(file); if (!current.bytes) return 'absent';
  return digest(current.bytes) + ':' + identity(ordinary(current.generation || file));
}
export function readHistoryStorage(file, { maxBytes = Infinity } = {}) {
  const current = marker(file);
  if (!current.generation) return { raw: current.raw, revision: current.bytes ? digest(current.bytes) + ':' + identity(ordinary(file)) : 'absent', legacyBytes: current.bytes };
  return scanGeneration(current, maxBytes);
}
export function scanGeneration(current, maxBytes = Infinity) {
  if (current.generation.endsWith('.zst')) return scanCompressedGeneration(current, maxBytes);
  // Scan only the size captured by this descriptor: a reader never sees half of
  // a later append and never mutates a torn tail. Repair belongs to the writer.
  const fd = fs.openSync(current.generation, 'r');
  try {
    const info = fs.fstatSync(fd, { bigint: true }); if (!info.isFile() || info.nlink !== 1n) throw Error('历史代际不是独立普通文件');
    const size = Number(info.size), buffer = Buffer.allocUnsafe(65536), events = [];
    if (size > maxBytes) throw Error('历史日志超过本次只读查询的预算');
    let position = 0, committedBytes = 0, fragments = [], header;
    while (position < size) {
      const count = fs.readSync(fd, buffer, 0, Math.min(buffer.length, size - position), position);
      if (!count) throw Error('历史代际在读取时缩短');
      let start = 0;
      for (let i = 0; i < count; i++) if (buffer[i] === 10) {
        const bytes = fragments.length ? Buffer.concat([...fragments, buffer.subarray(start, i)]) : buffer.subarray(start, i);
        let row; try { row = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw Error('历史日志包含损坏的完整记录，拒绝跳过'); }
        if (!header) {
          if (row.version !== current.raw.v || ![4, HISTORY_STORAGE_VERSION].includes(row.version)) throw Error('历史代际版本不受支持，请升级应用');
          if (row.type !== FORMAT || row.id !== current.raw.id || row.eventVersion !== 3 || !Number.isSafeInteger(row.createdAt) || row.createdAt < 0) throw Error('历史代际身份或事件版本不匹配');
          header = row;
        } else {
          if (row.seq !== events.length || !row.event || typeof row.event.t !== 'string') throw Error('历史日志事件序号不连续或类型无效');
          events.push(row.event);
        }
        committedBytes = position + i + 1; fragments = []; start = i + 1;
      }
      if (start < count) fragments.push(Buffer.from(buffer.subarray(start, count)));
      position += count;
    }
    if (!header) throw Error('历史日志缺少完整头记录');
    return { raw: { v: header.eventVersion, events }, marker: current.raw, generation: current.generation, committedBytes, size,
      tornTail: committedBytes !== size, revision: digest(current.bytes) + ':' + identity(info) };
  } finally { fs.closeSync(fd); }
}
function scanCompressedGeneration(current, maxBytes) {
  const fd = fs.openSync(current.generation, 'r');
  try {
    const info = fs.fstatSync(fd, { bigint: true }); if (!info.isFile() || info.nlink !== 1n) throw Error('历史代际不是独立普通文件');
    const size = Number(info.size), bytes = Buffer.allocUnsafe(size); let read = 0;
    while (read < size) { const count = fs.readSync(fd, bytes, read, size - read, read); if (!count) throw Error('历史代际在读取时缩短'); read += count; }
    const scan = scanZstdFrames(bytes), events = []; let header, decodedBytes = 0;
    const consume = (plain, complete) => {
      decodedBytes += plain.length; if (decodedBytes > maxBytes) throw Error('历史日志超过本次只读查询的预算');
      const end = plain.lastIndexOf(10); if (complete && end !== plain.length - 1) throw Error('完整压缩帧缺少 JSONL 断行');
      for (const line of new TextDecoder('utf-8', { fatal: true }).decode(plain.subarray(0, end + 1)).split('\n').slice(0, -1)) {
        let row; try { row = JSON.parse(line); } catch { throw Error('历史日志包含损坏的完整记录，拒绝跳过'); }
        if (!header) {
          if (row.type !== FORMAT || row.version !== current.raw.v || row.id !== current.raw.id || row.eventVersion !== 3 || !Number.isSafeInteger(row.createdAt) || row.createdAt < 0) throw Error('历史代际身份或事件版本不匹配');
          header = row;
        } else { if (row.seq !== events.length || !row.event || typeof row.event.t !== 'string') throw Error('历史日志事件序号不连续或类型无效'); events.push(row.event); }
      }
    };
    for (const [index, frame] of scan.frames.entries()) {
      const plain = decompressFrame(bytes.subarray(frame.start, frame.end));
      if (index === 0 && (plain.length === 0 || plain.indexOf(10) !== plain.length - 1)) throw Error('压缩日志首帧必须仅包含头记录');
      consume(plain, true);
    }
    if (!header) throw Error('历史日志缺少完整头记录');
    const recoverFromSeq = events.length;
    if (scan.tornStart !== undefined) consume(decompressPrefix(bytes.subarray(scan.tornStart)), false);
    return { raw: { v: header.eventVersion, events }, marker: current.raw, generation: current.generation, size, decodedBytes,
      committedBytes: scan.frames.at(-1)?.end || 0, recoverFromSeq, tornTail: scan.tornStart !== undefined, revision: digest(current.bytes) + ':' + identity(info) };
  } finally { fs.closeSync(fd); }
}
function publish(file, data) {
  const dir = directory(file); fs.mkdirSync(dir, { recursive: true });
  const name = 'history-' + crypto.randomBytes(16).toString('hex') + '.jsonl.zst', target = resolveIn(dir, name), id = crypto.randomBytes(16).toString('hex');
  const header = { type: FORMAT, version: HISTORY_STORAGE_VERSION, eventVersion: data.v, id, createdAt: Date.now() };
  const fd = fs.openSync(target, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, compressFrame(JSON.stringify(header) + '\n'));
    if (data.events.length) fs.writeFileSync(fd, compressFrame(data.events.map((event, seq) => JSON.stringify({ seq, event }) + '\n').join('')));
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  // Verify the whole successor before making it authoritative. The raw JSON
  // predecessor is archived byte-for-byte once; an old reader refuses v4.
  const current = marker(file);
  if (current.bytes && !current.generation) {
    const backup = resolveIn(dir, 'legacy-' + digest(current.bytes) + '.json');
    try { const old = fs.openSync(backup, 'wx', 0o600); try { fs.writeFileSync(old, current.bytes); fs.fsyncSync(old); } finally { fs.closeSync(old); } }
    catch (error) { if (error.code !== 'EEXIST') throw error; ordinary(backup); if (!fs.readFileSync(backup).equals(current.bytes)) throw error; }
  }
  const next = { v: HISTORY_STORAGE_VERSION, storage: FORMAT, generation: name, id };
  const verified = scanGeneration({ generation: target, raw: next, bytes: Buffer.from(JSON.stringify(next)) });
  if (verified.tornTail || verified.raw.events.length !== data.events.length) throw Error('新的历史代际校验失败');
  verifyGenerationInWorker(target, next, data);
  atomicJson(file, next); return next;
}
function verifyGenerationInWorker(file, marker, data) {
  const shared = new SharedArrayBuffer(8192), state = new Int32Array(shared, 0, 2);
  let entry = new URL('./history-verifier.mjs', import.meta.url);
  if (!fs.existsSync(entry) && process.isBun) entry = pathToFileURL(path.join(path.dirname(process.execPath), 'resources/sidecar/history-verifier.mjs'));
  if (!fs.existsSync(entry)) throw Error('历史独立校验器未打包，拒绝发布新代际');
  const worker = new Worker(entry, { execArgv: [], workerData: { file, marker, count: data.events.length, digest: digest(JSON.stringify(data.events)), shared } });
  // Publication is synchronous in this host. Only the isolated verifier writes
  // this completion cell; a timeout never authorizes pointer publication.
  worker.on('error', () => {}); worker.unref();
  const status = Atomics.wait(state, 0, 0, 60000);
  if (status === 'timed-out') { void worker.terminate(); throw Error('历史代际独立校验超时，未发布新指针'); }
  if (Atomics.load(state, 0) !== 1) throw Error('历史代际独立校验失败：' + new TextDecoder().decode(new Uint8Array(shared, 8, Atomics.load(state, 1))));
}
export class HistoryStore {
  constructor(file, observed) { this.file = file; this.observed = observed ? { revision: observed.revision } : null; this.refs = []; this.cursor = 0; this.closed = false; }
  save(data) {
    if (this.closed) throw Error('历史写入句柄已关闭');
    if (!this.lease) {
      this.lease = new WriterLease(directory(this.file));
      try {
        const current = readHistoryStorage(this.file);
        if (this.observed && current.revision !== this.observed.revision) throw Error('历史已被另一个写入者更新，请重新加载');
        if (!this.observed && current.raw) {
          const stored = current.raw.events;
          const matches = Array.isArray(stored) && stored.length <= data.events.length && stored.every((event, i) => JSON.stringify(event) === JSON.stringify(data.events[i]));
          if (matches) this.prime(data.events.slice(0, stored.length));
          else if (this.replaceUnobserved) this.cursor = Number.MAX_SAFE_INTEGER;
          else throw Error('已有历史必须先加载，拒绝用新的空句柄替换');
        }
        delete current.raw; this.state = current;
      } catch (error) { this.lease.close(); this.lease = null; throw error; }
    }
    const current = marker(this.file);
    if (this.state.marker ? current.raw?.id !== this.state.marker.id || current.raw?.generation !== this.state.marker.generation : (!!current.bytes !== !!this.state.legacyBytes || current.bytes && !current.bytes.equals(this.state.legacyBytes))) throw Error('历史代际已由其他写入者替换');
    let prefix = data.events.length >= this.cursor;
    for (let i = 0; prefix && i < this.cursor; i++) if (data.events[i] !== this.refs[i]) prefix = false;
    if (!this.state.generation || this.state.marker.v !== HISTORY_STORAGE_VERSION || !prefix) {
      this.validate?.(data);
      const next = publish(this.file, data);
      this.state = { marker: next, generation: resolveIn(directory(this.file), next.generation) };
      this.cursor = data.events.length; this.refs = data.events.slice();
      const info = ordinary(this.state.generation); this.state.size = Number(info.size); this.state.signature = identity(info); return;
    }
    const info = ordinary(this.state.generation);
    if (Number(info.size) !== this.state.size || this.state.signature && identity(info) !== this.state.signature) throw Error('历史日志在写入句柄之外变化，已停止写入');
    if (this.state.tornTail) {
      fs.truncateSync(this.state.generation, this.state.committedBytes); this.state.size = this.state.committedBytes; this.state.tornTail = false;
      if (this.state.recoverFromSeq !== undefined) this.cursor = this.state.recoverFromSeq;
    }
    if (data.events.length === this.cursor) return;
    const fd = fs.openSync(this.state.generation, 'a');
    try { const batch = data.events.slice(this.cursor).map((event, index) => JSON.stringify({ seq: this.cursor + index, event }) + '\n').join(''); fs.writeFileSync(fd, this.state.generation.endsWith('.zst') ? compressFrame(batch) : batch); fs.fsyncSync(fd); }
    catch (error) { this.closed = true; throw error; }
    finally { fs.closeSync(fd); }
    const after = ordinary(this.state.generation); this.state.size = Number(after.size); this.state.signature = identity(after); this.cursor = data.events.length; this.refs = data.events.slice();
  }
  prime(events) { this.refs = events.slice(); this.cursor = events.length; }
  close() { this.closed = true; this.lease?.close(); this.lease = null; this.refs = []; this.state = null; this.observed = null; }
}
