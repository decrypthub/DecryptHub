// DSH core/session/{fork,repair}.ts semantics adapted to this host's event tags.
// Started calls have unknown outcomes; neither a fork nor restart replays them.
export function closeHistoryTail(events, cause = 'interrupted') {
  let open = false, turnId, pending = new Map();
  for (const event of events) {
    if (event.t === 'turn-end') { open = false; turnId = undefined; pending.clear(); continue; }
    if (event.t === 'user' || event.t === 'continuation' && event.source?.kind === 'goal') { open = true; turnId = event.turnId; pending.clear(); }
    if (event.t === 'assistant') {
      open = true; turnId = event.turnId || turnId;
      for (const call of event.calls || []) pending.set(call.itemId || call.id, { call, started: false });
    }
    if (event.t === 'system' && event.source?.kind === 'tool-call-start') { const item = pending.get(event.itemId || event.id); if (item) item.started = true; }
    if (event.t === 'tool') pending.delete(event.itemId || event.id);
  }
  if (!open) return [];
  const at = events.at(-1)?.at || 0, closers = [];
  turnId ||= cause + '-tail-' + events.length;
  for (const { call, started } of pending.values()) {
    const code = started ? 'TOOL_OUTCOME_UNKNOWN' : 'TOOL_NOT_STARTED';
    const content = cause === 'forked'
      ? '此分支继承的历史没有包含该工具的完成结果，父会话可能在分支位置之后执行过它。只读或幂等操作可在需要时重试；存在副作用时，先核验外部状态或询问用户，不能盲目重放。'
      : started ? '该工具已记录开始，但没有可靠保存完成结果，执行结果未知。只读或幂等操作可在需要时重试；存在副作用时，先核验外部状态或询问用户，不能盲目重放。'
        : '该工具请求没有记录开始执行。需要时可重新发起。';
    closers.push({ t: 'tool', id: call.id, itemId: call.itemId, name: call.name, turnId, at, content, isError: true, error: { code }, source: { kind: cause + '-repair' } });
  }
  closers.push({ t: 'turn-end', turnId, at, stop: cause, source: { kind: cause + '-repair' } });
  return closers;
}
