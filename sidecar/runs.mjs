import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { atomicJson } from './paths.mjs';
const ACTIVE = new Set(['running', 'waiting_approval', 'waiting_user']);
export class RunStore {
  constructor(dataDir, emit = () => {}, { sessionId } = {}) {
    this.sessionId = sessionId;
    this.file = path.join(dataDir, '.runs.json'); this.journal = path.join(dataDir, '.run-events.jsonl'); this.emit = emit; this.runs = []; this.seq = 0;
    try { const s = JSON.parse(fs.readFileSync(this.file, 'utf8')); this.runs = s.runs || []; this.seq = s.seq || 0; } catch {}
    // The journal is fsynced before the snapshot; recover a crash between them.
    if (fs.existsSync(this.journal)) for (const line of fs.readFileSync(this.journal, 'utf8').split('\n')) {
      try {
        const e = JSON.parse(line); if (!Number.isSafeInteger(e.seq) || e.seq <= this.seq) continue;
        this.seq = e.seq;
        if (e.run && ['run-started', 'run-status'].includes(e.type)) {
          const index = this.runs.findIndex(r => r.id === e.run.id);
          if (index >= 0) this.runs[index] = e.run; else this.runs.push(e.run);
        }
      } catch {} // A torn final line carries no executable action.
    }
    this.runs = this.runs.slice(-100);
    for (const run of this.runs) if (ACTIVE.has(run.status)) Object.assign(run, { status: 'interrupted', endedAt: Date.now(), reason: '应用退出或执行中断；未确认的操作不会自动重放' });
    this.save();
  }
  save() { atomicJson(this.file, { v: 1, seq: this.seq, runs: this.runs.slice(-100) }); }
  event(runId, type, payload = {}) {
    const event = { seq: ++this.seq, runId, type, at: Date.now(), ...payload, ...(this.sessionId ? { sessionId: this.sessionId } : {}) }, fd = fs.openSync(this.journal, 'a', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(event) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    this.save(); this.emit(event); return event;
  }
  start({ workspace, mode, text, source = 'user' }) {
    const run = { id: crypto.randomUUID(), sessionId: this.sessionId, workspaceId: workspace.id, workspaceRevision: workspace.revision, mode, source, prompt: text.slice(0, 300), status: 'running', startedAt: Date.now() };
    this.runs.push(run); this.event(run.id, 'run-started', { run: { ...run } }); return run;
  }
  status(run, status, extra = {}) { Object.assign(run, { status, ...extra }); if (!ACTIVE.has(status)) run.endedAt = Date.now(); this.event(run.id, 'run-status', { run: { ...run } }); }
  latest() { return this.runs.at(-1) || null; }
  events(after = 0) {
    if (!fs.existsSync(this.journal)) return [];
    const out = []; for (const line of fs.readFileSync(this.journal, 'utf8').split('\n')) { try { const e = JSON.parse(line); if (e.seq > after) out.push(e); } catch {} }
    return out.slice(-500);
  }
}
