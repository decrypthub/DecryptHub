import { contextMetrics, limitInfo } from './context.mjs';
import { agentSystemText, contextToolDefinitions, CONTEXT_META_TOOLS } from './agent.mjs';
import { DEFAULT_TOOLS } from './catalog.mjs';

// Restore the last accepted sample when possible. Older histories get a passive,
// explicitly estimated reading, without an Agent, write lease, spill write or model call.
export function inspectContext(session, history) {
  if (session.agent) return session.agent.stats();
  const settings = session.requestSettings(), saved = session.contextState;
  if (saved?.workspaceId === session.workspace.id && saved.selection === JSON.stringify(session.modelSelection)
    && saved.stats?.limit === limitInfo(settings).limit && Number.isFinite(saved.stats.used) && saved.stats.parts) {
    return { ...saved.stats, compressing: false };
  }
  const plugins = (session.mgr.mcpHost?.status?.() || []).filter(item => item.state === 'ready');
  history.system = agentSystemText(settings, plugins, session.planMode.snapshot());
  const context = { sessionId: session.id, workspaceId: session.workspace.id, workRoot: session.workspace.root, team: session.team, getPlan: () => session.planMode.snapshot() };
  const tools = [...contextToolDefinitions(DEFAULT_TOOLS, context), ...CONTEXT_META_TOOLS].sort((a, b) => a.name.localeCompare(b.name));
  return { ...contextMetrics(settings, history.view({ prune: { keep: 6, minChars: 6000 } }), tools, { compressions: history.compressions }), estimated: true };
}
