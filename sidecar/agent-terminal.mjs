// Agent 可用的持久交互式终端。
//
// 为什么需要它（2026-11-02 外部 Agent 实测反馈的核心）：`workspace_shell` 是**一次性执行**——
// 启动、等结束、拿输出。它无法应付 frida / adb shell / python REPL / 交互式脚本这类
// 「程序停下来等你输入」的场景，而这种场景恰恰是逆向工作的主体。过去只能靠 timeout 硬等，
// 表现就是「命令挂住、没有任何输出、最后超时」，模型完全无法区分「在等输入」和「真的卡了」。
//
// 设计参考 DSH `terminal/terminal/src/types.ts` 的等待语义：
//   TerminalWaitReason = 'stdin_read' | 'inferred_idle' | 'timeout' | 'session_exit'
// 把「为什么把控制权还给你」作为一等结果返回，模型才知道下一步该发输入、该等、还是该停。

import crypto from 'node:crypto';
import { BoundedTextBuffer } from './terminal-buffer.mjs';

/** 等待结束的原因。模型据此决定下一步，而不是盲猜。 */
export const WAIT_REASONS = Object.freeze({
  /** 后端已经确认前台程序在等输入；提示符形状不能作为此证据。 */
  STDIN_READ: 'stdin_read',
  /** 输出安静了一段时间，推断它已空闲（启发式，不如 stdin_read 确定）。 */
  INFERRED_IDLE: 'inferred_idle',
  /** 等到上限仍无进展。 */
  TIMEOUT: 'timeout',
  /** 顶层进程退出。 */
  SESSION_EXIT: 'session_exit',
});

/**
 * 去掉 ANSI 转义序列与回车符，只留可读文本。
 *
 * 这一步是必需的：真实 PTY（node-pty）输出里提示符后面紧跟光标控制序列，
 * 例如 PowerShell 的 `PS C:\path>` 实际是 `PS C:\path>\x1b[0K\x1b[54G`。
 * 不做剥离，所有「提示符在行尾」的匹配都会失败——单元测试用干净字符串过得了，
 * 真实环境永远判定不出来（2026-11-02 真实链路验收就是这样暴露的）。
 */
export function stripAnsi(text) {
  return String(text || '')
    // CSI 序列（颜色、光标、清除行等）
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    // OSC 序列（窗口标题等）
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    // 其余单字符转义
    .replace(/\x1b[@-_]/g, '')
    // 回车：PTY 里 \r 常用于重绘当前行，保留会让匹配跨行失效
    .replace(/\r/g, '')
    // 退格与响铃
    .replace(/[\b\x07]/g, '');
}

// 提示符只是一条推测线索，不能证明前台进程已经阻塞在 stdin read。
const PROMPT_PATTERNS = [
  // shell 提示符：可选 user@host 前缀 + 可选路径 + $ / # / % / > 结尾
  // 覆盖 `$ `、`user@host:~$ `、`root@localhost:/# `、`PS C:\path>` 这几种
  /(?:^|\n)[^\n]{0,300}(?:[#$%]|>)\s*$/,
  // 明确在等口令
  /(?:^|\n)[^\n]{0,300}(?:password|passphrase|密码|口令)[^\n]{0,40}[:：]\s*$/i,
  // 常见交互工具
  /(?:^|\n)[^\n]{0,300}(?:\(y\/n\)|\[y\/N\]|\[Y\/n\]|Press any key|按任意键)[^\n]{0,20}$/i,
  // REPL / 调试器提示符
  /(?:^|\n)[^\n]{0,300}(?:>>>|\.\.\.|frida|gdb|pwndbg|lldb)>\s*$/i,
];

/** 输出末尾是否像在等待输入。输入会先剥离 ANSI 控制序列。 */
export function looksLikeStdinRead(text) {
  const tail = stripAnsi(text).slice(-800);
  if (!tail) return false;
  return PROMPT_PATTERNS.some(re => re.test(tail));
}

/**
 * 判断一次「等待」为什么结束。
 * 纯函数，便于单测：输入是客观事实，输出是四值之一。
 */
export function classifyWait({ exited, inputWaiting, quietMs, idleMs, elapsedMs, timeoutMs }) {
  if (exited) return WAIT_REASONS.SESSION_EXIT;
  if (inputWaiting === true) return WAIT_REASONS.STDIN_READ;
  if (quietMs >= idleMs) return WAIT_REASONS.INFERRED_IDLE;
  if (elapsedMs >= timeoutMs) return WAIT_REASONS.TIMEOUT;
  // 未退出、无提示符、尚未安静够久，但调用方传进来的等待已结束 → 只能算超时
  return WAIT_REASONS.TIMEOUT;
}

/** 视口裁剪：终端输出按字节保留尾部，并明确标记被丢弃。 */
export function tailViewport(text, maxChars = 8000) {
  text = String(text || '');
  if (text.length <= maxChars) return { viewport: text, truncated: false };
  // 从安全位置切，避免切开代理对
  let cut = text.length - maxChars;
  const prev = text.charCodeAt(cut - 1), cur = text.charCodeAt(cut);
  if (prev >= 0xd800 && prev <= 0xdbff && cur >= 0xdc00 && cur <= 0xdfff) cut += 1;
  return { viewport: text.slice(cut), truncated: true };
}

/**
 * 一个 Agent 可操作的终端会话。包装 SessionTerminals（UI 也在用同一套 PTY 实现）。
 */
export class AgentTerminal {
  constructor({ session, id, cwd, cols = 120, rows = 30 }) {
    this.session = session;
    this.id = id;
    this.cwd = cwd;
    this.cols = cols;
    this.rows = rows;
    this.seen = 0;      // 已读到的输出位置
    this.lastAt = Date.now();
    this.quietSince = Date.now();
  }

  /** 自上次读取以来新增的输出。 */
  async inspect() { if(Date.now()-(this.lastNativeProbe||0)<250)return; this.lastNativeProbe=Date.now(); await this.session.terminals.inspectForeground?.(this.id); }
  drain() {
    const snap = this.session.terminals.agentSnapshot?.(this.id) || this.session.terminals.snapshot(this.id);
    const all = snap.output || '';
    const start = snap.outputOffset || 0;
    const delta = all.slice(Math.max(0, this.seen - start));
    const dropped = this.seen < start;
    this.seen = start + all.length;
    if (delta) this.quietSince = Date.now();
    return { delta: dropped ? '[较早的未读输出已超出保留窗口]\n' + delta : delta, status: snap.status, exitCode: snap.exitCode ?? null, total: start + all.length,
      inputWaiting: snap.inputWaiting === true, protocolPending: snap.protocolPending === true, truncated: dropped || snap.truncated === true };
  }
}

/**
 * 等待终端出现「值得一提」的状态变化。
 * 与 DSH 一致：返回原因，不替调用方决定要不要继续等。
 */
export async function waitForTerminal(term, { waitMs = 30000, idleMs = 3000, signal, onOutput, requireOutput = false, until } = {}) {
  const budget = Math.max(0, Math.min(60000, waitMs));
  const startedAt = Date.now();
  const deadline = startedAt + budget;
  const output = new BoundedTextBuffer(256 * 1024);
  const append = delta => { if (delta) { output.append(delta); onOutput?.(delta); term.quietSince = Date.now(); } };
  const result = (reason, exitCode, extra = {}) => { const retained = output.snapshot(); return { reason, output: retained.text, exitCode, truncated: retained.truncated, ...extra }; };
  let lastStatus = 'running', inheritedTruncation = false;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    await term.inspect?.();
    const { delta, status, exitCode, inputWaiting, protocolPending, truncated } = term.drain();
    inheritedTruncation ||= truncated;
    lastStatus = status;
    append(delta);
    const exited = status !== 'running';
    const quietMs = Date.now() - term.quietSince;
    const elapsedMs = Date.now() - startedAt;

    // 退出是终态，任何时刻发现都要立刻返回。
    if (exited) return result(WAIT_REASONS.SESSION_EXIT, exitCode);

    // DSH terminal-bash/session.ts requires foreground/backend evidence for
    // stdin_read. Without native inspection, silence is only inferred_idle.
    if (!protocolPending && inputWaiting) return result(WAIT_REASONS.STDIN_READ, null);
    if (!protocolPending && until?.(output.snapshot().text)) return result(WAIT_REASONS.INFERRED_IDLE, null, { completed: true });
    if (!protocolPending && (!requireOutput || !output.isEmpty) && quietMs >= idleMs) {
      return result(WAIT_REASONS.INFERRED_IDLE, null, { truncated: inheritedTruncation || output.truncated, promptHint: looksLikeStdinRead(output.snapshot().text) });
    }
    await new Promise(r => setTimeout(r, 50));
  }
  // 到时限：再取一次状态与残留输出，避免刚好在最后一刻退出却被报成 timeout。
  await term.inspect?.(); const final = term.drain();
  append(final.delta);
  if (final.status !== 'running') return result(WAIT_REASONS.SESSION_EXIT, final.exitCode);
  if (!final.protocolPending && final.inputWaiting) return result(WAIT_REASONS.STDIN_READ, null);
  return result(WAIT_REASONS.TIMEOUT, null, { lastStatus, promptHint: looksLikeStdinRead(output.snapshot().text) });
}

export const newTerminalId = () => crypto.randomUUID();
