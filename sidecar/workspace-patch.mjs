// Batch file mutations: parse and simulate the whole patch before writing.
// Commit failures report actual applied paths; there is no pretend rollback.
// Reference: DSH tool-fs/patch/{plan,preflight,execute} and fs-patch/{parse,apply}.
import fs from 'node:fs';
import path from 'node:path';
import { workspacePath, workRoot } from './workspaces.mjs';
import { pathKey } from './paths.mjs';
import { contentHash } from './changes.mjs';

function parse(input) {
  const lines = String(input || '').trim().split(/\r?\n/);
  if (lines[0] !== '*** Begin Patch' || lines.at(-1) !== '*** End Patch') throw Error('补丁必须以 *** Begin Patch 开始、*** End Patch 结束');
  const operations = []; let current, hunk;
  for (let i = 1; i < lines.length - 1; i++) {
    const line = lines[i], header = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line);
    if (header) {
      current = { kind: header[1].toLowerCase(), path: header[2], content: '', hunks: [], line: i + 1 };
      operations.push(current); hunk = null; continue;
    }
    if (!current) throw Error(`补丁第 ${i + 1} 行缺少文件操作`);
    if (current.kind === 'add' && line.startsWith('+')) { current.content += line.slice(1) + '\n'; continue; }
    if (current.kind === 'update') {
      if (!hunk && line.startsWith('*** Move to: ')) { current.move = line.slice(13); continue; }
      if (line === '@@' || line.startsWith('@@ ')) { hunk = { anchor: line.slice(3) || null, before: [], after: [], eof: false }; current.hunks.push(hunk); continue; }
      if (line === '*** End of File') { if (!hunk) throw Error('End of File 前需要修改段'); hunk.eof = true; continue; }
      if (line === '' || /^[ +\-]/.test(line)) {
        if (!hunk) { hunk = { before: [], after: [], eof: false }; current.hunks.push(hunk); }
        if (hunk.eof) throw Error('End of File 后需要新的 @@ 修改段');
        if (!line.startsWith('+')) hunk.before.push(line.slice(1));
        if (!line.startsWith('-')) hunk.after.push(line.slice(1));
        continue;
      }
    }
    if (!line.trim()) continue;
    throw Error(`补丁第 ${i + 1} 行语法不正确`);
  }
  for (const operation of operations) if (operation.kind === 'update' && (!operation.hunks.length || operation.hunks.some(h => !h.before.length && !h.after.length))) throw Error('更新文件需要非空修改段：' + operation.path);
  return operations;
}

const normalize = [text => text, text => text.trimEnd(), text => text.trim(), text => text.trim().replace(/[\u2010-\u2015\u2212]/g, '-').replace(/[\u2018-\u201b]/g, "'").replace(/[\u201c-\u201f]/g, '"').replace(/[\u00a0\u2002-\u200a\u202f\u205f\u3000]/g, ' ')];
function locate(lines, expected, cursor, eof) {
  for (const transform of normalize) {
    for (let i = eof ? lines.length - expected.length : cursor; i <= lines.length - expected.length; i++)
      if (i >= 0 && expected.every((line, j) => transform(line) === transform(lines[i + j]))) return i;
  }
  return -1;
}
function applyHunks(text, hunks) {
  const bom = text.startsWith('\uFEFF'); if (bom) text = text.slice(1);
  const lines = text.replaceAll('\r\n', '\n').split('\n'); if (lines.at(-1) === '') lines.pop();
  let cursor = 0; const replacements = [];
  for (const hunk of hunks) {
    if (hunk.anchor) { const at = locate(lines, [hunk.anchor], cursor, false); if (at < 0) throw Error('未找到 @@ 上下文：' + hunk.anchor); cursor = at + 1; }
    let before = hunk.before, after = hunk.after;
    let at = before.length ? locate(lines, before, cursor, hunk.eof) : lines.length;
    if (at < 0 && before.at(-1) === '') { before = before.slice(0, -1); if (after.at(-1) === '') after = after.slice(0, -1); at = locate(lines, before, cursor, hunk.eof); }
    if (at < 0) throw Error('修改段与文件不匹配：' + before[0]);
    replacements.push({ at, length: before.length, after }); cursor = at + before.length;
  }
  let result = lines;
  for (const change of replacements.sort((a, b) => a.at - b.at).reverse()) result = [...result.slice(0, change.at), ...change.after, ...result.slice(change.at + change.length)];
  return (bom ? '\uFEFF' : '') + (result.length ? result.join('\n') + '\n' : '');
}

export function patchWorkspace(ctx, input) {
  const applied = [];
  try {
    const operations = parse(input), states = new Map(), plan = [];
    const state = relative => {
      const file = workspacePath(ctx, relative, { write: true }), key = pathKey(file);
      if (states.has(key)) return states.get(key);
      const exists = fs.existsSync(file); let content = null;
      if (exists) {
        const stat = fs.lstatSync(file); if (!stat.isFile()) throw Error('补丁目标不是普通文本文件：' + relative);
        const buffer = fs.readFileSync(file); content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer);
        if (content.includes('\0')) throw Error('不能对二进制文件应用补丁');
        if (ctx.readHashes && ctx.readHashes.get(file) !== contentHash(buffer)) throw Error('目标未读取或已发生变化，请先 workspace_read：' + relative);
      }
      const value = { file, content }; states.set(key, value); return value;
    };
    for (const operation of operations) {
      ctx.signal?.throwIfAborted();
      const source = state(operation.path), before = source.content;
      if (operation.kind !== 'add' && before === null) throw Error('补丁源文件不存在：' + operation.path);
      const after = operation.kind === 'delete' ? null : operation.kind === 'add' ? operation.content : applyHunks(before, operation.hunks);
      if (operation.move) {
        const destination = state(operation.move);
        if (pathKey(destination.file) === pathKey(source.file)) throw Error('移动的源和目标相同');
        plan.push({ file: destination.file, before: destination.content, after }); destination.content = after;
        plan.push({ file: source.file, before, after: null }); source.content = null;
      } else { plan.push({ file: source.file, before, after }); source.content = after; }
    }
    // Every operation above was simulated without mutating the filesystem.
    for (const operation of plan) {
      ctx.signal?.throwIfAborted();
      workspacePath(ctx, operation.file, { write: true });
      const current = fs.existsSync(operation.file) ? fs.readFileSync(operation.file, 'utf8') : null;
      if (current !== operation.before) throw Error('提交期间文件发生变化：' + operation.file);
      const options = { workspaceId: ctx.workspaceId, runId: ctx.runId, expectedHash: current === null ? undefined : contentHash(current) };
      if (operation.after === null) {
        if (ctx.changes) ctx.changes.remove(workRoot(ctx), operation.file, options);
        else fs.unlinkSync(operation.file);
        ctx.readHashes?.delete(operation.file);
      } else {
        if (ctx.changes) ctx.changes.write(workRoot(ctx), operation.file, operation.after, options);
        else { fs.mkdirSync(path.dirname(operation.file), { recursive: true }); fs.writeFileSync(operation.file, operation.after, { flag: current === null ? 'wx' : 'w' }); }
        ctx.readHashes?.set(operation.file, contentHash(operation.after));
      }
      applied.push(operation.file);
    }
    return { text: `补丁已应用，修改 ${new Set(applied).size} 个文件：\n${[...new Set(applied)].join('\n')}`, wrote: [...new Set(applied)] };
  } catch (error) {
    return { text: `补丁未完成：${error.message}\n${applied.length ? '已修改以下文件，未回滚，请重新读取后继续：\n' + applied.join('\n') : '尚未修改任何文件。'}`, isError: true, wrote: [...new Set(applied)] };
  }
}

export const PATCH_TOOLS = [{ name: 'apply_patch', description: '以 Codex 补丁语法批量新增、更新、删除或移动文件。先校验整份补丁，校验失败不修改文件；提交阶段失败会如实返回已修改路径。修改已有文件前先读取。',
  schema: { type: 'object', properties: { input: { type: 'string', description: '*** Begin Patch / *** End Patch 包围的补丁，包含 Add/Update/Delete File、可选 Move to、@@ 修改段和 End of File' } }, required: ['input'], additionalProperties: false },
  run: (args, ctx) => patchWorkspace(ctx, args.input),
}];
