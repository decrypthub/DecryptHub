// Client-only projection of owned command/terminal receipts. Unknown or
// malformed results stay on the generic input/output path, as DSH does.
export function terminalResult(event) {
  const args = event.args || {}, result = event.result;
  if (event.cancelled || typeof result !== 'string') return null;
  if (event.name === 'pwsh' || event.name === 'workspace_shell') {
    const exit = /\n\[exit code: (-?\d+|null)\]\s*$/.exec(result);
    const signal = /\n\[killed by signal: ([^\]\n]+)\]\s*$/.exec(result);
    const job = event.name === 'workspace_shell' && /^job \S+ exit (-?\d+|null) pid=\S+ time=\d+s out=\d+B/.exec(result);
    if (signal) return { label: signal[1], failed: true };
    if (exit || job) {
      const code = (exit || job)[1];
      return { label: code === 'null' ? '未取得退出码' : '退出码 ' + code, failed: code === 'null' || Number(code) !== 0 };
    }
    if (event.name === 'workspace_shell' && /^(?:已在后台启动 id=|前台等待 \d+ 秒已到，命令仍在运行，已转入后台)/.test(result))
      return { label: '已转入后台', failed: false };
    // Persistent shell receipts may also report resets or input waits. Do not
    // invent a zero exit status from an absent marker.
    return null;
  }
  if (event.isError || event.name !== 'terminal_send' || typeof args.text !== 'string') return null;
  let value;
  try { value = JSON.parse(result); } catch { return null; }
  if (!value || typeof value !== 'object') return null;
  if (value.kind === 'background' && typeof value.jobId === 'string' && value.jobId)
    return { label: '已转入后台', output: '后台任务：' + value.jobId, failed: false };
  if (value.kind !== 'foreground' || typeof value.viewport !== 'string') return null;
  const status = value.sessionStatus;
  if (status?.kind !== 'running' && status?.kind !== 'exited') return null;
  if (status.kind === 'exited') {
    const code = status.exitCode;
    if (code !== null && !Number.isInteger(code)) return null;
    return { label: code === null ? '终端已退出 · 退出码未知' : '终端退出码 ' + code,
      output: value.viewport, failed: code === null || code !== 0 };
  }
  const labels = { stdin_read: '等待终端输入', inferred_idle: '输出暂时安静 · 未确认结束', timeout: '等待超时 · 未确认结束' };
  if (!Object.hasOwn(labels, value.waitReason)) return null;
  return { label: labels[value.waitReason], output: value.viewport, failed: false };
}

export function toolFailed(event) {
  return !event.cancelled && (!!event.isError || terminalResult(event)?.failed === true);
}

export function toolState(event) {
  if (event.cancelled) return 'cancelled';
  if (event.result === undefined) return 'run';
  return toolFailed(event) ? 'err' : 'ok';
}
