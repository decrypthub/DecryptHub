// DSH tool-terminal/src/index.ts: owner-scoped handles, independent scrollback,
// exactly one send, and generic jobs for background sends. Legacy id/waitMs is accepted.
import crypto from 'node:crypto';
import { AgentTerminal, waitForTerminal } from './agent-terminal.mjs';
import { CollectedStream } from './shell-process.mjs';
import { trackJob } from './jobs.mjs';
const stores = new WeakMap();
function store(ctx) {
  if (!ctx.terminals) throw Error('当前环境没有交互终端后端');
  let entries = stores.get(ctx.terminals);
  if (!entries) stores.set(ctx.terminals, entries = new Map());
  return entries;
}
export function ownedTerminal(ctx, id) {
  const term = store(ctx).get(String(id || ''));
  if (!term) throw Error('没有这个 Agent 的终端：' + id);
  return term;
}
export async function openOwnedTerminal(ctx, args = {}) {
  if (args.type && args.type !== 'shell') throw Error('未注册的终端类型：' + args.type);
  const id = crypto.randomUUID();
  ctx.signal?.throwIfAborted();
  await ctx.terminals.open({ id, cwd: args.cwd, cols: args.cols, rows: args.rows, name: args.name, agentOwned: true, signal: ctx.signal });
  const term = new AgentTerminal({ session: { terminals: ctx.terminals }, id, cwd: ctx.terminals.snapshot(id).cwd });
  try {
    const result = await waitForTerminal(term, { waitMs: 30000, signal: ctx.signal, requireOutput: true });
    if (result.reason === 'session_exit' || (result.reason === 'timeout' && !result.output)) throw Error('终端未完成启动');
    store(ctx).set(id, term); return { term, motd: result.output };
  } catch (error) { await ctx.terminals.close(id); throw error; }
}
export async function closeOwnedTerminal(ctx, id) {
  const term = ownedTerminal(ctx, id);
  await ctx.terminals.close(term.id);
  store(ctx).delete(term.id);
}
function status(ctx, id) {
  const snap = ctx.terminals.agentSnapshot?.(id) || ctx.terminals.snapshot(id);
  return { sessionId: id, type: 'shell', ...(snap.pid ? { pid: snap.pid } : {}), status: snap.status === 'running' ? { kind: 'running' } : { kind: 'exited', exitCode: snap.exitCode, signal: null } };
}
export async function startOwnedSend(ctx, args) {
  const term = ownedTerminal(ctx, args.sessionId || args.id);
  if (term.sending) throw Error('此终端已经有一个进行中的输入交互');
  const text = String(args.text ?? '');
  if (text.length > 65535) throw Error('终端输入过长');
  const controller = new AbortController(), relay = () => controller.abort(ctx.signal.reason);
  ctx.signal?.throwIfAborted(); ctx.signal?.addEventListener('abort', relay, { once: true });
  term.sending = true;
  let interrupting = Promise.resolve();
  const interrupt = () => { interrupting = Promise.resolve(ctx.terminals.interrupt?.(term.id)).catch(() => {}); };
  controller.signal.addEventListener('abort', interrupt, { once: true });
  const release = async () => {
    await interrupting;
    if (controller.signal.aborted) {
      // Retain the slot until the interrupt and its output tail have drained.
      try { term.quietSince = Date.now(); await waitForTerminal(term, { waitMs: 3000 }); } catch {}
    }
    term.sending = false; controller.signal.removeEventListener('abort', interrupt); ctx.signal?.removeEventListener('abort', relay);
  };
  try {
    term.quietSince = Date.now();
    const data = args.submit === false ? text : text + '\r';
    if (data.length) {
      if (ctx.terminals.writeAgent) await ctx.terminals.writeAgent(term.id, data, controller.signal, args.commandPreview || text);
      else ctx.terminals.input(term.id, data);
    }
    controller.signal.throwIfAborted();
    if (args.run_in_background) ctx.signal?.removeEventListener('abort', relay);
    const output = new CollectedStream({ maxChars: 256 * 1024 });
    const done = waitForTerminal(term, { waitMs: args.waitMs ?? 30000, signal: controller.signal, until: args.until, onOutput: data => output.push(data) })
      .then(result => ({ kind: 'foreground', viewport: result.output, waitReason: result.reason, sessionStatus: status(ctx, term.id).status, truncated: result.truncated }))
      .finally(release);
    return { done, output, cancel: () => controller.abort(Error('终端输入已取消')) };
  } catch (error) {
    await release(); throw error;
  }
}
function background(ctx, operation, args) {
  const id = crypto.randomUUID(), proc = { id, startedAt: Date.now(), status: 'running', code: null, reason: null, isolated: false, get out() { return operation.output.tail; }, err: '',
    get truncated() { return operation.output.truncated; }, readOutput: () => ({ delta: operation.output.read().text, lossy: operation.output.truncated }), kill: operation.cancel };
  proc.done = operation.done.then(result => { proc.status = 'exited'; proc.code = result.sessionStatus.kind === 'exited' ? result.sessionStatus.exitCode : 0; operation.output.push('\nwaitReason=' + result.waitReason); return result; }, error => { proc.status = 'exited'; proc.reason = 'cancelled'; operation.output.push('\n' + error.message); return { error: error.message }; }).finally(() => { proc.endedAt = Date.now(); });
  trackJob(proc, { owner: ctx.sessionId || ctx.projectDir, projectDir: ctx.projectDir, label: `${args.sessionId || args.id}: ${args.text || '(input)'}` });
  return { kind: 'background', jobId: id };
}
const text = { type: 'string' }, number = { type: 'number' }, bool = { type: 'boolean' };
const tool = (name, description, properties, required, run) => ({ name, description, schema: { type: 'object', properties, required, additionalProperties: false }, run: async (args, ctx) => {
  try { return { text: JSON.stringify(await run(args, ctx)) }; } catch (error) { return { text: error.message, isError: true }; }
} });
const identity = { sessionId: text, id: { type: 'string', description: '旧调用兼容字段；新调用使用 sessionId。' } };
export const TERMINAL_TOOLS = [
  tool('terminal_open', '创建当前 Agent 独有的持久终端。仅用于需要持久 shell/REPL 状态或交互输入的任务；普通短命令使用 workspace_shell。返回 sessionId。', { type: { type: 'string', enum: ['shell'] }, name: text, cwd: text, cols: number, rows: number }, [], async (args, ctx) => { const { term, motd } = await openOwnedTerminal(ctx, args); return { ...status(ctx, term.id), ...(args.name ? { name: args.name } : {}), motd }; }),
  tool('terminal_send', '向持久终端发送文本，默认补 Enter。inferred_idle/timeout 均不能证明命令结束；session_exit 只表示顶层会话退出。run_in_background=true 返回 jobId，用 workspace_job_output/kill 收集或取消。', { ...identity, text, submit: bool, run_in_background: bool, waitMs: number }, ['text'], async (args, ctx) => { const operation = await startOwnedSend(ctx, args); return args.run_in_background ? background(ctx, operation, args) : operation.done; }),
  tool('terminal_read', '读取保留输出的一页，不发送输入，也不推进发送交互的游标。offset 从最新行向前计数，默认 0；count 默认 500。', { ...identity, offset: number, count: number, waitMs: number }, [], async (args, ctx) => { const term = ownedTerminal(ctx, args.sessionId || args.id); if (args.waitMs !== undefined && args.offset === undefined && args.count === undefined) { if (term.sending) throw Error('此终端有进行中的输入交互'); return waitForTerminal(term, { waitMs: args.waitMs, signal: ctx.signal }); } return ctx.terminals.read(term.id, { offset: args.offset, count: args.count }); }),
  tool('terminal_signal', '向当前 Agent 终端的前台工作发送信号。POSIX 使用实际前台进程组；Windows 支持控制台 SIGINT 和树级 SIGTERM。拒绝 SIGKILL 顶层 shell，结束整个会话请用 terminal_close。', { ...identity, signal: { type: 'string', enum: ['SIGINT','SIGTERM','SIGKILL','SIGTSTP','SIGHUP'] } }, ['signal'], async (args, ctx) => { const term = ownedTerminal(ctx, args.sessionId || args.id); return ctx.terminals.signalForeground(term.id,args.signal); }),
  tool('terminal_close', '关闭当前 Agent 的终端，并等待它所拥有的进程树退出。', identity, [], async (args, ctx) => { const id = args.sessionId || args.id; await closeOwnedTerminal(ctx, id); return { sessionId: id, outcome: 'closed' }; }),
  tool('terminal_list', '列出当前 Agent 所拥有的持久终端，不包含其他聊天、子代理或用户侧栏的终端。', {}, [], async (_args, ctx) => [...store(ctx).values()].map(term => status(ctx, term.id))),
];
for (const tool of TERMINAL_TOOLS) if (!['terminal_open', 'terminal_list'].includes(tool.name)) tool.schema.anyOf = [{ required: ['sessionId'] }, { required: ['id'] }];
