// Presentation only: stable turn identities, bounded previews and a fixed-pitch rail.
export const TURN_PITCH = 12;
export function turnPreview(turn) {
  const plain = value => String(value || '').replace(/\s+/g, ' ').trim();
  const input = plain(turn.user?.content) || (turn.user?.attachments?.length ? '附件消息' : '任务过程');
  const output = plain(turn.answers.map(a => a.content).join(' ')) || (turn.active ? '正在回复…' : '查看执行过程');
  return { input: input.slice(0, 240), output: output.slice(0, 360) };
}
export function visibleTurnIndex(offsets, top, height, totalHeight) {
  if (!offsets.length) return -1;
  if (top > 0 && top + height >= totalHeight - 2) return offsets.length - 1;
  const target = top + Math.min(100, height * .2);
  let low = 0, high = offsets.length - 1;
  while (low < high) { const mid = Math.ceil((low + high) / 2); if (offsets[mid] <= target) low = mid; else high = mid - 1; }
  return low;
}
export function railWindow(count, top, height) {
  const start = Math.max(0, Math.floor(top / TURN_PITCH) - 4);
  return { start, end: Math.min(count, Math.ceil((top + height) / TURN_PITCH) + 4) };
}
