import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { resolveIn } from './paths.mjs';
import { approvedServers, normalizeServers } from './mcphost.mjs';

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const slug = value => { if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(value || '')) throw Error('名称使用 1–64 个小写字母、数字或连字符'); return value; };
export class ExtensionStore {
  constructor({ directory, getSettings, saveSettings, plugins, mcpHost, tasks, changed = () => {} }) {
    Object.assign(this, { directory, getSettings, saveSettings, plugins, mcpHost, tasks, changed });
  }
  location(kind, scope, ctx) {
    if (!['skill', 'memory'].includes(kind)) throw Error('未知扩展类型');
    scope ||= ctx.projectId ? 'project' : 'user';
    if (!['session', 'project', 'user'].includes(scope)) throw Error('未知保存范围');
    const id = scope === 'project' ? ctx.projectId : scope === 'session' ? ctx.sessionId : 'global';
    if (!id || !/^[a-zA-Z0-9-]+$/.test(id)) throw Error('当前没有可用的项目或会话');
    return { scope, root: resolveIn(this.directory, `extensions/${scope}/${id}/${kind}`) };
  }
  file(kind, scope, name, ctx) {
    const loc = this.location(kind, scope, ctx);
    return { ...loc, file: resolveIn(loc.root, kind === 'skill' ? slug(name) + '/SKILL.md' : slug(name) + '.md') };
  }
  list(kind, ctx) {
    const result = [];
    for (const scope of ['session', ...(ctx.projectId ? ['project'] : []), 'user']) {
      const { root } = this.location(kind, scope, ctx);
      if (!fs.existsSync(root)) continue;
      for (const entry of fs.readdirSync(root, { withFileTypes: true }).slice(0, 100)) {
        const name = kind === 'skill' ? entry.name : entry.name.replace(/\.md$/, '');
        try {
          const { file } = this.file(kind, scope, name, ctx), stat = fs.lstatSync(file);
          if (!stat.isFile() || stat.nlink > 1 || stat.size > 65536) continue;
          const fd = fs.openSync(file, 'r'), buffer = Buffer.alloc(Math.min(stat.size, 2048));
          let preview;
          try { const bytes = fs.readSync(fd, buffer); preview = buffer.subarray(0, bytes).toString('utf8'); }
          finally { fs.closeSync(fd); }
          const description = kind === 'skill' ? preview.match(/^description:[ \t]*(.+)$/m)?.[1] : preview.split('\n').find(x => x.trim());
          result.push({ name, scope, description: (description || name).slice(0, 160) });
        } catch { /* Ignore unrelated files, symlinks and invalid names. */ }
      }
    }
    return result;
  }
  read(kind, input, ctx) {
    const { file, scope } = this.file(kind, input.scope, input.name, ctx), st = fs.lstatSync(file);
    if (!st.isFile() || st.nlink > 1 || st.size > 65536) throw Error('扩展文件不是普通文件或超过 64KB');
    const content = fs.readFileSync(file, 'utf8');
    return { name: input.name, scope, content, hash: digest(content) };
  }
  write(kind, input, ctx) {
    const { file, scope } = this.file(kind, input.scope, input.name, ctx);
    const content = String(input.content || '').trim();
    if (!content || Buffer.byteLength(content) > (kind === 'memory' ? 16384 : 65536)) throw Error('内容为空或超过保存上限');
    if (kind === 'skill' && (!/^---\r?\n/.test(content) || !/^description:[ \t]*\S[^\r\n]*$/m.test(content) || !new RegExp('^name:[ \\t]*["\']?' + input.name + '["\']?[ \\t]*$', 'm').test(content)))
      throw Error('SKILL.md 需要 YAML frontmatter，包含 name 和 description');
    if (fs.existsSync(file) && this.read(kind, input, ctx).hash !== input.expectedHash)
      throw Error('覆盖前请先读取并提供最新 expectedHash');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // resolve again after mkdir so an intervening link cannot redirect the write.
    this.file(kind, scope, input.name, ctx);
    const temporary = file + '.' + crypto.randomUUID() + '.tmp';
    fs.writeFileSync(temporary, content + '\n', { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, file);
    this.changed(); return this.read(kind, input, ctx);
  }
  index(ctx) {
    const skills = this.list('skill', ctx), memories = this.list('memory', ctx);
    return JSON.stringify({ skills: skills.slice(0, 12), memories: memories.slice(0, 12), skillCount: skills.length, memoryCount: memories.length });
  }
  async saveMcp(servers, approveNames = []) {
    const settings = this.getSettings(), previous = settings.mcpServers;
    const next = approvedServers(this.plugins.preserveManagedServers(servers), previous, approveNames);
    settings.mcpServers = next;
    try { await this.saveSettings(); } catch (error) { settings.mcpServers = previous; throw error; }
    await this.mcpHost.apply(); this.changed(); return this.mcpHost.status();
  }
  async manage(kind, input, ctx) {
    const action = input.action;
    if (kind === 'skill' || kind === 'memory') {
      if (action === 'list') return this.list(kind, ctx);
      if (action === 'read') return this.read(kind, input, ctx);
      if (action === 'write') return this.write(kind, input, ctx);
    }
    if (kind === 'automation') {
      if (action === 'list') return this.tasks.list().filter(t => t.sessionId === ctx.sessionId);
      if (action === 'save') {
        if (!input.id && (!input.time || !Array.isArray(input.days) || !input.days.length)) throw Error('请先确认自动化执行时间和星期，再保存');
        const previous = input.id && this.tasks.tasks.find(t => t.id === input.id);
        if (input.id && previous?.sessionId !== ctx.sessionId) throw Error('只能管理绑定当前会话的自动化');
        this.tasks.upsert({ ...input, sessionId: ctx.sessionId });
        return this.manage('automation', { action: 'list' }, ctx);
      }
      if (action === 'remove') {
        if (!this.tasks.tasks.some(t => t.id === input.id && t.sessionId === ctx.sessionId)) throw Error('当前会话中没有该自动化');
        this.tasks.remove(input.id);
        return this.manage('automation', { action: 'list' }, ctx);
      }
    }
    if (kind === 'mcp') {
      if (action === 'list') return this.mcpHost.status().map(({ name, state, version, toolCount, error }) => ({ name, state, version, toolCount, error }));
      if (action === 'save') {
        if (!input.name || input.name.startsWith('decrypthub_')) throw Error('官方组件请由用户在插件页配置');
        const normalized = normalizeServers({ [input.name]: { ...input.config, enabled: input.config?.enabled === true } });
        if (!normalized[input.name]) throw Error('MCP 服务名无效');
        const cfg = normalized[input.name];
        if (cfg.transport === 'stdio' ? !cfg.command : !/^https?:\/\//i.test(cfg.url)) throw Error('请提供 MCP 启动命令或有效的服务地址');
        await this.saveMcp({ ...this.getSettings().mcpServers, ...normalized }, [input.name]);
        return this.manage('mcp', { action: 'list' }, ctx);
      }
    }
    throw Error('不支持的管理操作');
  }
}
