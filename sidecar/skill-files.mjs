// Filesystem-backed skill discovery. The catalog carries summaries; full
// instructions are loaded explicitly. Reference: DSH skill-filesystem/tool-skill.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { parse } from 'yaml';
import { resolveIn, isSensitivePath, findProjectRoot } from './paths.mjs';
import { bundledResource, officeRuntime } from './bundled-resources.mjs';

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const namePattern = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function skillFrontmatter(content) {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!match) return null;
  const meta = parse(match[1], { maxAliasCount: 0 });
  if (!meta || typeof meta !== 'object' || !namePattern.test(meta.name || '') || typeof meta.description !== 'string' || !meta.description.trim()) return null;
  return { name: meta.name, description: meta.description.trim(), modelInvocable: meta['disable-model-invocation'] !== true,
    userInvocable: meta['user-invocable'] !== false, body: content.slice(match[0].length).trim() };
}

export function filesystemSkills(ctx) {
  const roots = [];
  if (ctx.workRoot) for (const folder of ['.decrypthub/skills', '.agents/skills']) roots.push({ root: path.join(findProjectRoot(ctx.workRoot), folder), scope: 'project' });
  if (ctx.protectedRoot) roots.push({ root: path.join(ctx.protectedRoot, 'skills'), scope: 'user' });
  roots.push({ root: path.join(os.homedir(), '.agents', 'skills'), scope: 'user' });
  const office = bundledResource('office-skills'); if (office) roots.push({ root: office, scope: 'bundled' });
  const result = [];
  for (const { root, scope } of roots) {
    const scan = () => {
    const found = [];
    try {
      resolveIn(root, '.');
      for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 256)) {
        try {
          const relative = entry.isDirectory() ? path.join(entry.name, 'SKILL.md') : entry.isFile() && entry.name.endsWith('.md') ? entry.name : null;
          if (!relative) continue;
          const file = resolveIn(root, relative), stat = fs.lstatSync(file);
          if (!stat.isFile() || stat.nlink > 1 || stat.size > 65536) continue;
          const content = fs.readFileSync(file, 'utf8'), meta = skillFrontmatter(content);
          if (!meta) continue;
          found.push({ name: meta.name, description: meta.description.slice(0, 500), scope,
            source: 'filesystem:' + digest(file), path: file, resourceBase: { kind: 'directory', path: path.dirname(file) },
            ...(scope === 'bundled' ? { resourceRoot: root } : {}),
            modelInvocable: meta.modelInvocable, userInvocable: meta.userInvocable, updatedAt: stat.mtimeMs });
        } catch { /* One invalid skill must not hide independent skills. */ }
      }
    } catch { /* An absent optional skill directory is normal. */ }
    return found;
    };
    result.push(...(ctx.skillCatalogCache ? ctx.skillCatalogCache.read(root, scan) : scan()));
  }
  return result;
}

export function readFilesystemSkill(summary) {
  const file = resolveIn(summary.resourceBase.path, path.basename(summary.path)), stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.nlink > 1 || stat.size > 65536) throw Error('技能文件已变化或超过读取上限');
  let content = fs.readFileSync(file, 'utf8'); const meta = skillFrontmatter(content);
  if (!meta || meta.name !== summary.name) throw Error('技能已变化，请重新列举技能');
  if (summary.scope === 'bundled' && ['office-render', 'office-recalculate', 'office-export-pdf'].includes(summary.name)) {
    const runtime = officeRuntime(); content += runtime ? '\n\n## Installed LibreOffice Kit\n\nUse these absolute paths; pass cli as the first argument to node:\n\n' + JSON.stringify({ libreofficeKit: runtime }, null, 2) : '\n\nLibreOffice Kit is unavailable in this installation. Follow the bundled sidecar setup instructions.';
  }
  return { ...summary, content, hash: digest(content), updatedAt: stat.mtimeMs,
    modelInvocable: meta.modelInvocable, userInvocable: meta.userInvocable };
}

export const SKILL_TOOLS = [{
  name: 'skill', description: '加载可用技能清单中指定技能的完整说明。任务明确提及或符合某个技能时，先加载再执行。',
  schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false },
  run: async ({ name }, ctx) => {
    const item = ctx.extensions.list('skill', ctx).find(item => item.name === name);
    if (!item) throw Error('技能不存在或不允许模型主动调用：' + name);
    const loaded = ctx.extensions.read('skill', item, ctx);
    if (loaded.modelInvocable === false) throw Error('此技能只允许用户主动调用');
    return { text: JSON.stringify(loaded) };
  },
}, {
  name: 'skill_resource_read', description: '读取技能目录内引用的参考文件或脚本正文。路径相对于该技能的 resourceBase；只读取，不执行脚本，不扩大权限。',
  schema: { type: 'object', properties: { name: { type: 'string' }, source: { type: 'string' }, path: { type: 'string' }, offset: { type: 'integer', minimum: 1 }, limit: { type: 'integer', minimum: 1, maximum: 2000 } }, required: ['name', 'path'], additionalProperties: false },
  run: async (args, ctx) => {
    const item = ctx.extensions.list('skill', ctx).find(item => item.name === args.name && (!args.source || item.source === args.source));
    if (!item) throw Error('技能不存在或不可用');
    const skill = ctx.extensions.read('skill', item, ctx);
    if (skill.modelInvocable === false) throw Error('此技能只允许用户主动调用');
    if (isSensitivePath(args.path)) throw Error('不能读取技能中的敏感文件');
    const file = resolveIn(skill.resourceRoot || skill.resourceBase.path, path.resolve(skill.resourceBase.path, args.path)), info = fs.lstatSync(file);
    if (!info.isFile() || info.nlink > 1 || info.size > 8 * 1024 * 1024) throw Error('资源不是普通文件或超过读取上限');
    const text = fs.readFileSync(file, 'utf8'); if (text.includes('\0')) throw Error('资源不是文本文件');
    const lines = text.split(/\r?\n/), start = (args.offset || 1) - 1, end = Math.min(lines.length, start + (args.limit || 2000));
    const body = lines.slice(start, end).map((line, index) => `${start + index + 1}: ${line}`).join('\n');
    return { text: `${file}（${lines.length} 行）\n${body.slice(0, 40000)}${body.length > 40000 || end < lines.length ? '\n[还有内容，请用 offset/limit 继续读取]' : ''}` };
  },
}];
