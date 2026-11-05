import { validateAttachments } from './attachments.mjs';
import { resolveAttachments, estimateTokens } from './context.mjs';
import { parseSessionReferenceText } from './session-reference-uri.mjs';
import { prepareSessionReferences } from './session-references.mjs';

export function steerQueued(session, id, runId) {
  const item = session.queue.find(row => row.id === id);
  if (!item) return { ok: false, code: 'queue-item-not-found', error: '这条消息已不在队列中' };
  if (!session.agent?.running || !session.agent.acceptingSteer || session.closing || runId && session.activeRun?.id !== runId) return { ok: false, code: 'steer-unavailable', error: '当前任务已不再接受插话，消息仍保留在队列中' };
  item.delivery = 'steer'; session.saveState(); session.mgr.emitList();
  return { ok: true, steered: true };
}

// History commits before acknowledgement removes a row. A restart can identify
// an already committed user id, instead of losing or replaying that submission.
export async function appendQueuedSteering(agent) {
  const context = agent.getToolContext();
  const items = context.pendingSteering?.() || [];
  for (const item of items) {
    if (agent.abort?.signal.aborted) return;
    if (agent.hist.events.some(event => event.t === 'user' && event.id === item.id)) { context.ackSteering?.(item.id); continue; }
    const settings = agent.getSettings(), vision = !!((settings.provider === 'anthropic' ? settings.anthropic : settings.openai) || {}).vision;
    const attachments = validateAttachments(agent.projectDir, item.attachments || [], { workRoot: context.workRoot, vision });
    const reference = parseSessionReferenceText(item.text);
    const attached = attachments.length ? await resolveAttachments(attachments, { browser: agent.browser, projectDir: agent.projectDir, workRoot: context.workRoot, vision }) : '';
    if (agent.abort?.signal.aborted) return;
    const at = Date.now();
    agent.hist.append({ t: 'user', id: item.id, turnId: agent.turnId, at, steering: true, displayContent: item.text,
      ...(reference.references.length ? { renderedContent: reference.text } : {}), attachments,
      images: attachments.filter(a => a.kind === 'attachment' && a.image).map(a => a.id),
      content: [reference.text || '请查看附件并继续。', attached].filter(Boolean).join('\n\n'), ...(attached ? { att: estimateTokens(attached) } : {}) });
    context.ackSteering?.(item.id);
    agent.emit('user', { id: item.id, turnId: agent.turnId, at, steering: true, content: reference.text, rawContent: item.text, attachments });
    if (reference.references.length && context.sessionQuery) {
      const prepared = await prepareSessionReferences(context.sessionQuery, { ...context, signal: agent.abort.signal }, reference.references, { contextWindow: agent.stats().limit });
      agent.hist.append({ t: 'continuation', turnId: agent.turnId, content: prepared.content, source: { kind: 'session-reference', references: prepared.metadata } });
    }
  }
}
