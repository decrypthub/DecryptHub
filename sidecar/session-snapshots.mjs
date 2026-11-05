// Passive history windows: browsing never starts an Agent or repairs storage.
// Reference: DSH api/session-controller/history/{controller.ts,history.ts}.
import path from 'node:path';
import { History } from './history.mjs';
import { inspectContext } from './context-inspection.mjs';

export function historyWindow(events, { beforeSeq = events.length, turns = 50 } = {}) {
  if (!Number.isSafeInteger(beforeSeq) || beforeSeq < 0 || beforeSeq > events.length) throw Error('历史切点无效，请重新加载');
  if (!Number.isSafeInteger(turns) || turns < 1 || turns > 100) throw Error('每页对话轮数必须在 1–100 之间');
  let startSeq = beforeSeq, count = 0;
  while (startSeq > 0) {
    const event = events[--startSeq];
    if (event.t === 'user' || event.t === 'continuation' && event.source?.kind === 'goal') if (++count >= turns) break;
  }
  return { events: events.slice(startSeq, beforeSeq), startSeq, endSeq: beforeSeq, totalEvents: events.length, hasEarlier: startSeq > 0 };
}

export function passiveHistory(session) {
  return session.agent?.hist.events || History.load(path.join(session.projectDir, '.agent-history.json'), '').events;
}

export function sessionSnapshot(session, request = {}) {
  const agent = session.agent, history = agent?.hist || History.load(path.join(session.projectDir, '.agent-history.json'), '');
  const window = historyWindow(history.events, request);
  return { ...window, revision: session.eventRevision || 0, state: session.publicState(), partial: agent?.partial || '', partialReasoning: agent?.partialReasoning || '',
    partialItem: agent?.currentItem || null, context: inspectContext(session, history) };
}
