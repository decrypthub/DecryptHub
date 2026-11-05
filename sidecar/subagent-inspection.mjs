// Address child histories through the existing passive corpus; opening a view never restores a writer.
import fs from 'node:fs';
import { resolveIn } from './paths.mjs';
import { historyWindow } from './session-snapshots.mjs';

function childRecords(directory) {
  try {
    const rows = JSON.parse(fs.readFileSync(resolveIn(directory, '.subagents.json'), 'utf8'));
    if (!Array.isArray(rows)) throw Error('子代理索引格式无效');
    return rows;
  } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
export function subagentAddress(session, ids) {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 2 || ids.some(id => typeof id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id))) throw Error('子代理路径无效');
  const ctx = session.toolCtx(), corpus = session.mgr.sessionQuery.corpus(ctx);
  let parent = session.id, directory = session.projectDir, manager = session.subagents, record, target;
  for (const id of ids) {
    target = corpus.get(id);
    record = (manager?.records || childRecords(directory)).find(row => row.id === id && row.workspaceId === ctx.workspaceId);
    if (!record || !target || target.parentSessionId !== parent) throw Error('子代理不存在或不属于当前会话和工作区');
    directory = resolveIn(directory, '.subagents/' + id);
    manager = target.agent()?.delegatedChildren;
    parent = id;
  }
  return { ctx, target, record, manager, directory };
}
export async function inspectSubagent(session, ids, request = {}) {
  const address = subagentAddress(session, ids), { ctx, target, record, directory } = address;
  const observed = await session.mgr.sessionQuery.observe(ctx, target);
  // Recheck ownership after the asynchronous read, including project switches.
  subagentAddress(session, ids);
  const live = target.agent();
  const children = address.manager?.list(ctx.workspaceId) || childRecords(directory).filter(row => row.workspaceId === ctx.workspaceId).map(({ summary, ...row }) => ({ ...row, status: row.status === 'running' ? 'interrupted' : row.status, preview: summary?.slice(0, 180) || '' }));
  return { ...historyWindow(observed.events, { turns: 20, ...request }),
    agent: { ...record, status: live?.running ? 'running' : record.status === 'running' ? 'interrupted' : record.status },
    children, partial: live?.partial || '', partialReasoning: live?.partialReasoning || '', partialItem: live?.currentItem || null,
    context: live?.stats() || null };
}
export function subagentOwner(session, ids) {
  subagentAddress(session, ids);
  let manager = session.subagents;
  for (const id of ids.slice(0, -1)) manager = manager.restoreChild(id).delegatedChildren;
  return { manager, id: ids.at(-1) };
}
export function teamMemberIds(session) {
  const corpus = session.mgr.sessionQuery.corpus(session.toolCtx()), members = new Set([session.id]);
  for (const record of corpus.values()) {
    const visited = new Set(); let parent = record;
    while (parent?.parentSessionId && !visited.has(parent.id)) {
      visited.add(parent.id);
      if (parent.parentSessionId === session.id) { members.add(record.id); break; }
      parent = corpus.get(parent.parentSessionId);
    }
  }
  return members;
}
