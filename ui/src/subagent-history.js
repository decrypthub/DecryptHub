// Merge passive, absolute-sequence windows without letting an older page replace live status.
export function mergeSubagentWindow(previous, next) {
  if (!previous) return next;
  if (next.startSeq < previous.startSeq) return { ...previous, startSeq: next.startSeq, hasEarlier: next.hasEarlier, events: [...next.events, ...previous.events.slice(next.endSeq - previous.startSeq)] };
  if (next.totalEvents < previous.totalEvents) return next;
  return { ...next, startSeq: previous.startSeq, hasEarlier: previous.hasEarlier, events: [...previous.events.slice(0, next.startSeq - previous.startSeq), ...next.events] };
}
