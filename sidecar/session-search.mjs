// Read-only local history search. No Agent construction, tools, or project-file reads.
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { setImmediate as yieldEventLoop } from 'node:timers/promises';
import { History } from './history.mjs';

const MAX_FILE = 8 * 1024 * 1024, MAX_QUERY_BYTES = 32 * 1024 * 1024;
const normalize = value => String(value || '').normalize('NFKC').toLowerCase();
const matches = (value, terms) => { const text = normalize(value); return terms.every(term => text.includes(term)); };

async function readHistory(file, remaining, signal) {
  signal?.throwIfAborted();
  let handle;
  try {
    const before = await fs.lstat(file);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink > 1 || before.size > Math.min(MAX_FILE, remaining)) return { skipped: true, bytes: 0 };
    handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const stat = await handle.stat(), limit = Math.min(MAX_FILE, remaining);
    if (!stat.isFile() || stat.nlink > 1 || stat.size > limit) return { skipped: true, bytes: 0 };
    const buffer = Buffer.alloc(Math.min(limit + 1, stat.size + 1));
    let bytes = 0;
    while (bytes < buffer.length) {
      signal?.throwIfAborted();
      const part = await handle.read(buffer, bytes, buffer.length - bytes, bytes);
      if (!part.bytesRead) break;
      bytes += part.bytesRead;
    }
    if (bytes > stat.size || bytes > limit) return { skipped: true, bytes };
    return { events: History.fromJSON(JSON.parse(buffer.subarray(0, bytes).toString('utf8'))).events, bytes };
  } catch (error) {
    signal?.throwIfAborted();
    return error.code === 'ENOENT' ? { events: [], bytes: 0 } : { skipped: true, bytes: 0 };
  } finally { await handle?.close(); }
}

function messageText(event) {
  if (event.t === 'assistant') return String(event.content || '');
  if (event.t !== 'user') return '';
  const text = String(event.content || '');
  if (event.displayContent == null && /^【(?:系统|运行提示|工作区已切换)】/.test(text)) return '';
  return String(event.displayContent ?? text.split('\n\n【当前状态')[0].split('\n\n【附件·')[0]);
}

export async function searchSessions({ sessions, projects, query, signal }) {
  if (typeof query !== 'string' || query.length > 500) throw Error('搜索内容最多 500 个字符');
  const terms = normalize(query.replaceAll('\0', '')).trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return { matches: [], skipped: 0 };
  const projectMap = new Map(projects.map(p => [p.id, p])), results = [];
  let bytes = 0, skipped = 0, index = 0;
  for (const session of [...sessions.values()]) {
    signal?.throwIfAborted();
    if (++index % 4 === 0) await yieldEventLoop(undefined, { signal });
    const projectId = session.projectId, project = projectMap.get(projectId);
    if (!project) continue;
    const metadata = [session.title, project.name, ...(project.folders || []).map(f => f.root)].join(' ');
    // The renderer already has these immediate matches; avoid unrelated excerpts.
    if (matches(metadata, terms)) continue;
    const loaded = session.agent?.hist?.events;
    const record = loaded ? { events: loaded, bytes: 0 } : await readHistory(path.join(session.projectDir, '.agent-history.json'), MAX_QUERY_BYTES - bytes, signal);
    bytes += record.bytes;
    if (record.skipped) { skipped++; continue; }
    let examined = 0;
    for (const event of record.events || []) {
      signal?.throwIfAborted();
      const raw = messageText(event);
      examined += raw.length * 2;
      if (examined > MAX_FILE || (loaded && bytes + examined > MAX_QUERY_BYTES)) { skipped++; break; }
      if (!raw || !matches(metadata + '\n' + raw, terms)) continue;
      const text = raw.replace(/\s+/g, ' ').trim(), lower = normalize(text);
      const positions = terms.map(term => lower.indexOf(term)).filter(n => n >= 0), at = positions.length ? Math.min(...positions) : 0;
      const offset = Math.max(0, at - 36), excerpt = (offset ? '…' : '') + text.slice(offset, offset + 180) + (text.length > offset + 180 ? '…' : '');
      // Deletion or moving a Session during the await must not publish old ownership.
      if (sessions.get(session.id) === session && session.projectId === projectId) results.push({ sessionId: session.id, projectId, excerpt, turnId: event.turnId || null });
      break;
    }
    if (loaded) bytes += examined;
  }
  signal?.throwIfAborted();
  return { matches: results, skipped };
}
