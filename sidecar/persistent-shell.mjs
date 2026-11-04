// Adapted from DeepSeek Harness tool-pwsh-persistent/src/index.ts (MIT, 2026 DeepSeek).
// Keep per-owner serialization, nonce completion markers, fresh exit status and reset
// after cancellation/timeout/exit. Windows 5.1 needs a literal ESC construction.
import crypto from 'node:crypto';
import { ownedTerminal, openOwnedTerminal, closeOwnedTerminal, startOwnedSend } from './terminal-tools.mjs';
import { utf8Tail } from './terminal-output.mjs';
const states = new WeakMap();
export function wrapPwsh(command, marker) {
  const body = command.replaceAll('`', '``').replaceAll('"', '`"').replaceAll('$', '`$').replaceAll('\r', '').replaceAll('\n', '`n').replaceAll('\x1b', '$([char]27)');
  return `Write-Output '${marker.start}'; $LASTEXITCODE = $null; $__s = 1; try { Invoke-Expression "${body}"; $__ok = $? } catch { $__ok = $false }; if ($null -ne $LASTEXITCODE) { $__s = [int]$LASTEXITCODE } else { $__s = if ($__ok) { 0 } else { 1 } }; Write-Output ('${marker.end}' + $__s)`;
}
export function capturedCommand(text, marker, wrapper) {
  const end = text.lastIndexOf(marker.end);
  if (end < 0) return;
  const match = /^(-?\d+) *(?:\r?\n|$)/.exec(text.slice(end + marker.end.length));
  if (!match) return;
  const start = text.lastIndexOf(marker.start, end);
  return { text: text.slice(start < 0 ? 0 : start + marker.start.length, end).replaceAll(wrapper, '').replace(/^\r?\n/, '').replace(/\r?\n$/, ''), incomplete: start < 0, exitCode: Number(match[1]) };
}
function renderCapture(output) {
  const text = utf8Tail(output.text, 16000);
  return [output.incomplete ? '[较早的命令输出已超出终端保留窗口]' : '', text.truncated ? '[输出已截断，以下为保留尾部]' : '', text.text,
    output.exitCode ? `[exit code: ${output.exitCode}]` : ''].filter(Boolean).join('\n');
}
export async function runPersistentPwsh(ctx, command, { timeoutMs = 300000 } = {}) {
  if (typeof command !== 'string' || !command.trim()) throw Error('command 不能为空');
  let state = states.get(ctx.terminals);
  if (!state) states.set(ctx.terminals, state = { tail: Promise.resolve(), id: null });
  const operation = state.tail.then(async () => {
    const deadline = new AbortController(), timer = setTimeout(() => deadline.abort(Error('持久 PowerShell 命令超时')), timeoutMs);
    const signal = ctx.signal ? AbortSignal.any([ctx.signal, deadline.signal]) : deadline.signal;
    const context = { ...ctx, signal };
    const reset = async () => { const id = state.id; state.id = null; if (id) await closeOwnedTerminal(context, id); };
    let marker, wrapper, fallback = '';
    try {
      signal.throwIfAborted();
      if (state.id) {
        // The user/model may have explicitly closed the cached terminal.
        try { ownedTerminal(context, state.id); } catch { state.id = null; }
        if (state.id && ctx.terminals.snapshot(state.id).status !== 'running') await reset();
      }
      if (!state.id) state.id = (await openOwnedTerminal(context, { type: 'shell', name: 'pwsh' })).term.id;
      const nonce = crypto.randomUUID(); marker = { start: `__DH_PWSH_START_${nonce}__`, end: `__DH_PWSH_END_${nonce}:` };
      wrapper = wrapPwsh(command, marker);
      let first = true;
      for (;;) {
        signal.throwIfAborted();
        const send = await startOwnedSend(context, { sessionId: state.id, text: first ? wrapper : '', submit: first, commandPreview: command,
          until: text => !!capturedCommand(text, marker, wrapper) });
        first = false;
        const result = await send.done;
        const retained = ctx.terminals.read(state.id, { offset: 0, count: 10000 });
        fallback = retained.text;
        const complete = capturedCommand(retained.text, marker, wrapper);
        if (complete) return { text: renderCapture(complete) || '(无输出)' };
        if (result.sessionStatus.kind === 'exited') {
          const code = result.sessionStatus.exitCode; await reset();
          return { text: `${fallback}\n[shell exited: ${code ?? 'unknown'}]\n持久 PowerShell 已重置；下一次从项目目录与初始环境开始。` };
        }
        // An exact backend stdin wait is evidence; a prompt-shaped output or quiet
        // child is not. Interactive workflows should use the terminal tools.
        if (result.waitReason === 'stdin_read') return { text: fallback + `\n[终端 ${state.id} 等待输入；可用 terminal_send 继续交互]` };
      }
    } catch (error) {
      if (state.id) { try { fallback = ctx.terminals.read(state.id, { offset: 0, count: 10000 }).text; } catch {} await reset(); }
      if (ctx.signal?.aborted) throw error;
      if (deadline.signal.aborted) return { text: `命令在 ${timeoutMs / 1000} 秒后超时，持久 PowerShell 已重置。\n${utf8Tail(fallback, 16000).text}`, isError: true };
      throw error;
    } finally { clearTimeout(timer); }
  });
  state.tail = operation.then(() => {}, () => {});
  return operation;
}
export const PERSISTENT_SHELL_TOOLS = [{ name: 'pwsh', available: () => process.platform === 'win32',
  description: '在当前 Agent 的持久 PowerShell 中执行命令。变量、当前目录和环境跨调用保留；用完成标记和真实退出码判断结果，不能把安静当作完成。默认命令上限 300 秒；超时/取消/顶层退出后重置 shell。需要交互输入或后台发送时使用 terminal_open/send。',
  schema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'], additionalProperties: false },
  run: async (args, ctx) => { try { return await runPersistentPwsh(ctx, args.command); } catch (error) { return { text: error.message, isError: true }; } },
}];
