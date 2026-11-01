// 自动化任务：每天在固定时间把一句话交给 AI 去跑。
// 存储：<userData>/tasks.json；调度：进程内 30s 轮询（应用退出则停，符合桌面端预期）。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { atomicJson } from './paths.mjs';

const TICK = 30 * 1000;

function readJson(f, def) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; } }

export class TaskStore {
  constructor({ userDataDir, getSessions, log, onChange = () => {} }) {
    this.file = path.join(userDataDir, 'tasks.json');
    this.getSessions = getSessions;
    this.log = log || (() => {});
    this.onChange = onChange;
    this.tasks = readJson(this.file, []).filter(t => t && t.id);
    this.timer = null;
    this.busy = new Set();
    this.schedulingFrom = Date.now();
    let recovered = false;
    for (const t of this.tasks) if (t.lastStatus === 'running') { t.lastStatus = 'error'; t.lastError = '上次应用退出时任务中断，请检查结果后重新运行'; recovered = true; }
    if (recovered) this.save(false);
  }

  save(notify = true) { atomicJson(this.file, this.tasks); if (notify) this.onChange(this.list().map(t => ({ ...t, nextAt: this.nextAt(t) }))); }

  list() { return this.tasks.map(t => ({ ...t })).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)); }
  pauseForSession(sessionId) {
    let changed = false;
    for (const task of this.tasks) if (task.sessionId === sessionId) { task.enabled = false; task.lastStatus = 'needs_attention'; task.lastError = '绑定的对话已删除，请重新选择会话后再启用'; changed = true; }
    if (changed) this.save();
  }

  upsert(input) {
    const now = Date.now();
    const t = this.tasks.find(x => x.id === input.id);
    if (input.id && !t) throw new Error('任务不存在');
    if (t && this.busy.has(t.id)) throw new Error('请等待正在运行的任务结束后再编辑');
    const base = t ? structuredClone(t) : { id: 't' + crypto.randomBytes(4).toString('hex'), createdAt: now, runs: [] };
    base.title = String(input.title || base.title || '未命名任务').slice(0, 80);
    base.prompt = String(input.prompt || base.prompt || '').slice(0, 4000);
    if (!base.prompt.trim()) throw new Error('请填写自动化任务内容');
    if (input.time && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(input.time)) throw new Error('时间格式应为 00:00 到 23:59');
    base.time = input.time || base.time || '09:00';
    if (input.sessionId !== undefined) {
      if (input.sessionId && !this.getSessions().sessions.has(input.sessionId)) throw new Error('绑定的会话不存在');
      base.sessionId = input.sessionId || null;
    }
    if (input.days && (!Array.isArray(input.days) || !input.days.length || input.days.some(d => !Number.isInteger(d) || d < 0 || d > 6))) throw new Error('请至少选择一天，星期必须有效');
    base.days = input.days ? [...new Set(input.days)].sort() : (base.days || [0, 1, 2, 3, 4, 5, 6]);
    base.enabled = input.enabled !== undefined ? !!input.enabled : (base.enabled !== false);
    if (!base.sessionId) throw new Error('请选择项目内的执行会话');
    if (!t) this.tasks.push(base); else this.tasks = this.tasks.map(x => x.id === t.id ? base : x);
    this.save();
    return this.list();
  }

  remove(id) { if (this.busy.has(id)) throw new Error('请先等待任务结束'); this.tasks = this.tasks.filter(t => t.id !== id); this.save(); return this.list(); }

  /** 从「现在」到下一次触发的时间戳 */
  nextAt(t, from = Date.now()) {
    if (!t.enabled) return null;
    const [hh, mm] = String(t.time || '09:00').split(':').map(Number);
    for (let d = 0; d < 8; d++) {
      const when = new Date(from);
      when.setDate(when.getDate() + d);
      when.setHours(hh || 0, mm || 0, 0, 0);
      const ts = when.getTime();
      if (ts <= from) continue;
      if (!t.days || t.days.includes(when.getDay())) return ts;
    }
    return null;
  }

  /** 到点则执行；返回本次启动的任务 id 列表 */
  async tick() {
    const now = Date.now();
    const fired = [];
    for (const t of this.tasks) {
      if (!t.enabled || this.busy.has(t.id)) continue;
      const next = this.nextAt(t, Math.max(t.lastAt || 0, t.createdAt || 0, this.schedulingFrom));
      if (!next || next > now) continue;
      fired.push(t.id);
      this.run(t.id).catch(e => this.log('任务执行失败: ' + e.message));
    }
    return fired;
  }

  /** 执行一次：新建会话 → 打开浏览器 → 把提示词交给 AI */
  async run(id, { manual } = {}) {
    const t = this.tasks.find(x => x.id === id);
    if (!t) throw new Error('任务不存在');
    if (this.busy.has(id)) return { ok: false, error: '这个任务正在运行' };
    this.busy.add(id);
    const startedAt = Date.now();
    t.lastAt = startedAt;
    t.lastStatus = 'running';
    this.save();
    try {
      const mgr = this.getSessions();
      // 复用同一个会话（= 同一个浏览器 profile）：定时任务往往是「运营某个账号」，
      // 每次新建会话会换 profile，登录态就丢了。所以固定用一个，第二次起直接续上。
      let session = t.sessionId ? mgr.sessions.get(t.sessionId) : null;
      if (!session) throw Object.assign(new Error('绑定会话已关闭，请重新选择项目内的执行会话'), { needsAttention: true });
      mgr.emitList();
      if (session.mgr.workspaces.availability(session.workspace).availability !== 'ready') throw Object.assign(new Error('项目目录不可用，请打开会话重新选择目录'), { needsAttention: true });
      if (session.mode === 'full-access') throw Object.assign(new Error('自动化不能继承宿主机权限，请先将绑定会话切换为标准或只读权限'), { needsAttention: true });
      const sent = session.send({ text: t.prompt, source: 'automation' });
      if (!sent?.ok) throw Object.assign(new Error(sent?.error || '发送失败'), { needsAttention: ['project-directory-unavailable', 'model-required', 'busy'].includes(sent?.code) });
      const finished = await session.completion;
      t.lastStatus = finished?.status === 'completed' ? 'ok' : finished?.status === 'needs_attention' ? 'needs_attention' : 'error';
      t.lastError = t.lastStatus === 'ok' ? '' : finished?.error || (t.lastStatus === 'needs_attention' ? '需要你批准权限或补充信息，请打开绑定会话后继续' : '任务没有正常完成');
      t.runs = [{ at: startedAt, manual: !!manual, sessionId: session.id, runId: sent.runId, ok: t.lastStatus === 'ok', status: t.lastStatus, error: t.lastError }, ...(t.runs || [])].slice(0, 20);
    } catch (e) {
      t.lastStatus = e.needsAttention ? 'needs_attention' : 'error';
      t.lastError = String(e.message || e).slice(0, 300);
      t.runs = [{ at: startedAt, manual: !!manual, ok: false, status: t.lastStatus, error: t.lastError }, ...(t.runs || [])].slice(0, 20);
      this.log(`任务「${t.title}」失败: ${t.lastError}`);
      throw e;
    } finally {
      this.busy.delete(id);
      this.save();
    }
    return { ok: true };
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { this.tick().catch(() => {}); }, TICK);
    if (this.timer.unref) this.timer.unref();
  }

  stop() { if (this.timer) { clearInterval(this.timer); this.timer = null; } }
}
