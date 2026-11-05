const lines = value => { const result = value == null || value === '' ? [] : value.split('\n'); if (result.at(-1) === '') result.pop(); return result; };

// Bounded Myers comparison. A costly comparison degrades to whole-file
// replacement, as the reference recorder does after its comparison timeout.
export function lineCounts(before, after, maxWork = 600000) {
  const left = lines(before), right = lines(after);
  let start = 0, endLeft = left.length, endRight = right.length;
  while (start < endLeft && start < endRight && left[start] === right[start]) start++;
  while (endLeft > start && endRight > start && left[endLeft - 1] === right[endRight - 1]) { endLeft--; endRight--; }
  const n = endLeft - start, m = endRight - start;
  if (!n || !m) return { added: m, deleted: n };
  const positions = new Map([[1, 0]]); let work = 0;
  for (let distance = 0; distance <= n + m; distance++) {
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      if (++work > maxWork) return { added: right.length, deleted: left.length, replacement: true };
      let x = diagonal === -distance || diagonal !== distance && (positions.get(diagonal - 1) ?? -1) < (positions.get(diagonal + 1) ?? -1)
        ? positions.get(diagonal + 1) ?? 0 : (positions.get(diagonal - 1) ?? 0) + 1;
      let y = x - diagonal;
      while (x < n && y < m && left[start + x] === right[start + y]) { x++; y++; if (++work > maxWork) return { added: right.length, deleted: left.length, replacement: true }; }
      positions.set(diagonal, x);
      if (x >= n && y >= m) return { added: (distance + m - n) / 2, deleted: (distance + n - m) / 2 };
    }
  }
}
function groups(store, workspaceId, runId) {
  const result = new Map();
  for (const entry of store.items) {
    if (entry.workspaceId !== workspaceId || entry.runId !== runId || entry.status !== 'applied') continue;
    const group = result.get(entry.path);
    if (group) group.last = entry; else result.set(entry.path, { first: entry, last: entry });
  }
  return result;
}
export function turnFileDetail(store, workspaceId, runId, file) {
  const group = groups(store, workspaceId, runId).get(file);
  if (!group) throw Error('这轮的文件记录已不可用');
  const before = store.detail(group.first.id, workspaceId), after = store.detail(group.last.id, workspaceId);
  const oversized = before.windows.before?.truncated || after.windows.after?.truncated;
  const binary = before.before?.includes('\0') || after.after?.includes('\0');
  return { path: file, runId, before: before.before, after: after.after, oversized: !!oversized, binary: !!binary };
}
export function turnFiles(store, workspaceId, runId) {
  const files = [];
  for (const file of groups(store, workspaceId, runId).keys()) {
    const detail = turnFileDetail(store, workspaceId, runId, file);
    if (!detail.oversized && !detail.binary && detail.before === detail.after) continue;
    files.push({ path: file, created: detail.before === null, removed: detail.after === null,
      ...(detail.oversized ? { oversized: true } : detail.binary ? { binary: true } : lineCounts(detail.before, detail.after)) });
  }
  return { runId, files };
}
