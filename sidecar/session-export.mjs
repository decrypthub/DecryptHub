// Backend-neutral logical logs and referenced attachments, streamed to ZIP.
// Reference: DSH session-log-export/src/archive.ts (MIT).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { Zip, ZipDeflate } from 'fflate';
import { passiveHistory } from './session-snapshots.mjs';
import { History } from './history.mjs';
import { attachment } from './attachments.mjs';
import { resolveIn } from './paths.mjs';

export async function exportSessionArchive(session, destination, { signal, includeDescendants = true } = {}) {
  if (!path.isAbsolute(destination || '') || !/\.zip$/i.test(destination)) throw Error('导出路径必须是绝对 ZIP 文件路径');
  if (fs.existsSync(destination)) throw Error('目标文件已存在，请选择新的文件名');
  const temporary = path.join(path.dirname(destination), '.' + path.basename(destination) + '.' + crypto.randomUUID() + '.tmp');
  const fd = fs.openSync(temporary, 'wx', 0o600), media = new Map(), seen = new Set(); let failure, entries = 0;
  const check = () => { signal?.throwIfAborted(); if (session.closing) throw Error('会话已关闭，导出已取消'); if (failure) throw failure; };
  const zip = new Zip((error, bytes) => { if (error) { failure = error; return; } if (!failure) try { fs.writeFileSync(fd, bytes); } catch (error) { failure = error; } });
  async function add(name, chunks) {
    check(); const entry = new ZipDeflate(name, { level: 6 }); zip.add(entry); entries++;
    for await (const bytes of chunks) { check(); entry.push(bytes, false); await yieldTurn(); }
    check(); entry.push(new Uint8Array(), true);
  }
  async function* serialized(id, events, parentSessionId) {
    yield Buffer.from(JSON.stringify({ type: 'decrypthub-session', version: 3, id, parentSessionId: parentSessionId || null }) + '\n');
    for (let seq = 0; seq < events.length; seq++) { check(); yield Buffer.from(JSON.stringify({ seq, event: events[seq] }) + '\n'); }
  }
  async function collect(id, directory, events, parentSessionId, prefix = '') {
    if (seen.has(id)) throw Error('会话后代索引存在循环或重复标识'); seen.add(id);
    for (const event of events) for (const ref of [...(event.attachments || []), ...(event.images || [])]) if (ref.id && /^[a-f0-9-]{36}$/.test(ref.id)) {
      const meta = attachment(directory, ref.id), name = meta.image ? `media/${meta.id}.${({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' })[meta.mime] || 'bin'}` : `files/${meta.hash.slice(0,2)}/${meta.hash}/${meta.name.replace(/[\\/\x00-\x1f]/g, '_')}`;
      if (media.has(name) && media.get(name).hash !== meta.hash) throw Error('附件导出路径冲突，拒绝混用不同内容');
      if (!media.has(name)) media.set(name, meta);
    }
    await add(prefix + 'session.v3.jsonl', serialized(id, events, parentSessionId));
    if (!includeDescendants) return;
    let children; try { children = JSON.parse(fs.readFileSync(resolveIn(directory, '.subagents.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; children = []; }
    if (!Array.isArray(children)) throw Error('子代理索引格式无效');
    for (const child of children) {
      if (!/^[a-f0-9-]{36}$/.test(child.id || '')) throw Error('子代理标识无效');
      const childDir = resolveIn(directory, '.subagents/' + child.id), live = session.subagents.jobs.get(child.id)?.agent || session.subagents.resumable.get(child.id);
      live?.persist(); const events = live?.hist.events || History.load(resolveIn(childDir, '.agent-history.json'), '').events;
      await collect(child.id, childDir, events, id, 'subagents/' + child.id + '/');
    }
  }
  try {
    session.agent?.persist();
    await collect(session.id, session.projectDir, passiveHistory(session).slice(), session.parentSessionId);
    for (const [name, meta] of media) {
      const digest = crypto.createHash('sha256');
      async function* chunks() { for await (const bytes of fs.createReadStream(meta.file, { highWaterMark: 65536 })) { check(); digest.update(bytes); yield bytes; } if (digest.digest('hex') !== meta.hash) throw Error('附件在导出期间发生变化'); }
      await add(name, chunks());
    }
    zip.end(); check(); fs.fsyncSync(fd); fs.closeSync(fd);
    fs.linkSync(temporary, destination); fs.unlinkSync(temporary);
    return { path: destination, entries, bytes: fs.statSync(destination).size };
  } catch (error) { zip.terminate(); try { fs.closeSync(fd); } catch { /* Already closed before publication failure. */ } try { fs.unlinkSync(temporary); } catch { /* Only this exclusive temporary file is removed. */ } throw error; }
}
