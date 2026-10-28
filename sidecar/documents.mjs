import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectReadRoot, workRoot, workspacePath } from './workspaces.mjs';
import { readWorkspace } from './workspace.mjs';
export const documentWorkspaceKey = ws => [ws?.id, ws?.revision, ws?.projectRevision, ws?.root].join(':');
export function readDocument(session, input) {
  if (input.workspace !== documentWorkspaceKey(session.workspace)) throw Error('此文档属于之前的工作目录，请从当前文件列表重新打开');
  const ctx = selectReadRoot(session.toolCtx(), input.root === 'primary' ? undefined : input.root), raw = String(input.path || '');
  if (!raw || raw.length > 4096 || /^(?:javascript|data|https?|vbscript):/i.test(raw)) throw Error('不支持的文档路径');
  let name = raw.startsWith('file:') ? fileURLToPath(raw) : raw;
  const full = workspacePath(ctx, name), root = workRoot(ctx);
  name = path.relative(root, full).split(path.sep).join('/');
  return { path: name, root: input.root || 'primary', content: readWorkspace(ctx, name), markdown: /\.(?:md|markdown)$/i.test(name), workspace: input.workspace };
}
