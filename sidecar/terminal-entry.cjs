// Trusted, private terminal worker. stdin/stdout carry JSON lines, never MCP.
const path = require('node:path');
const readline = require('node:readline');
const pty = require('node-pty');
let terminal, emulator, inspector, protocolWrites = Promise.resolve(), actions = Promise.resolve(), stopping = false, win32Input = false, modeBuf = '';
const send = message => process.stdout.write(JSON.stringify(message) + '\n');
const exit = code => { emulator?.dispose(); send({ type: 'exit', exitCode: code }); process.stdout.write('', () => process.exit(code || 0)); };
const stop = () => { if (stopping) return; stopping = true; if (terminal) { try { terminal.kill(); } catch {} } else exit(0); setTimeout(() => process.exit(0), 1500); };
readline.createInterface({ input: process.stdin }).on('line', line => {
  // Control-plane teardown/interrupt must not wait behind a terminal reply that
  // a busy or hostile foreground application can keep extending indefinitely.
  try {
    const control = JSON.parse(line);
    if (control.action === 'close') { stop(); return; }
    if (control.action === 'interrupt' && terminal && !stopping) {
      terminal.write('\x03'); if (control.requestId) send({ type: 'written', requestId: control.requestId }); return;
    }
    if (control.action === 'signal' && terminal && !stopping) {
      try { const foreground=inspector.signalTerminalForeground(terminal.pid,control.data); send({type:'written',requestId:control.requestId,foreground}); }
      catch(error) { send({type:'request-error',requestId:control.requestId,message:error.message}); }
      return;
    }
  } catch { /* The normal request path reports malformed input. */ }
  actions = actions.then(async () => {
  try {
    if (line.length > 200000) throw Error('终端消息过长');
    const message = JSON.parse(line);
    if (message.action === 'open' && !terminal && !stopping) {
      inspector = await import('./terminal-inspection.mjs');
      const file = message.shellPath || (process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe') : '/bin/bash');
      const args = process.platform === 'win32' ? ['-NoLogo', '-NoProfile'] : ['--noprofile', '--norc', '-i'];
      // Windows 上用 winpty 后端：ConPTY 下 PSReadLine 的 win32-input-mode 对裸 CR 处理不一致，
      // winpty 会按控制台输入翻译字符，Enter 可以正常提交。
      terminal = pty.spawn(file, args, { cwd: message.cwd, cols: message.cols, rows: message.rows, env: process.env, name: 'xterm-256color', ...(process.platform === 'win32' ? { useConpty: false } : { useConpty: true }) });
      if (message.agentOwned) {
        const { Terminal } = require('@xterm/headless');
        emulator = new Terminal({ cols: message.cols, rows: message.rows, scrollback: 0 });
        emulator.onData(data => { if (!stopping) terminal.write(data); });
      }
      terminal.onData(data => {
        // 模式序列可能被拆到多个 chunk，保留尾部再判断。
        modeBuf = (modeBuf + data).slice(-128);
        if (modeBuf.includes('\x1b[?9001h')) win32Input = true;
        if (modeBuf.includes('\x1b[?9001l')) win32Input = false;
        if (emulator && !stopping) {
          send({ type: 'protocol', pending: true });
          protocolWrites = protocolWrites.then(() => new Promise(resolve => emulator.write(data, resolve)));
          const current = protocolWrites;
          current.then(() => { if (current === protocolWrites && !stopping) send({ type: 'protocol', pending: false }); }).catch(error => { send({ type: 'error', message: error.message }); stop(); });
        }
        send({ type: 'data', data });
      }); terminal.onExit(event => exit(event.exitCode));
      send({ type: 'ready', pid: terminal.pid });
    } else if (message.action === 'inspect' && terminal && !stopping) {
      for (;;) { const current = protocolWrites; await current; if (current === protocolWrites) break; }
      send({ type: 'inspected', requestId: message.requestId, foreground: inspector.inspectTerminalForeground(terminal.pid) });
    } else if (message.action === 'signal' && terminal && !stopping) {
      try { const foreground = inspector.signalTerminalForeground(terminal.pid, message.data); send({ type: 'written', requestId: message.requestId, foreground }); }
      catch (error) { send({ type: 'request-error', requestId: message.requestId, message: error.message }); }
    } else if (message.action === 'input' && terminal && !stopping) {
          // A generated terminal-protocol response belongs before the next user send.
          for (;;) { const current = protocolWrites; await current; if (current === protocolWrites) break; }
          // PSReadLine 打开 win32-input-mode 时，换行必须作为 Enter 键事件发送，裸 CR 会被当成插入换行。
          const enter = '\x1b[13;28;13;1;0;1_\x1b[13;28;13;0;0;1_';
          const text = String(message.data);
          // 诊断脚本要求原样写入，便于对比不同 Enter 编码。
          const raw = process.env.JSRA_TERMINAL_RAW_INPUT === '1';
          // winpty 经控制台输入翻译字符，提交一行需要 CRLF；win32-input-mode 则用键事件。
          terminal.write(raw ? text : win32Input ? text.replace(/\r\n?/g, enter) : process.platform === 'win32' ? text.replace(/\r\n?/g, '\r\n') : text);
          if (message.requestId) send({ type: 'written', requestId: message.requestId });
        }
    else if (message.action === 'resize' && terminal && !stopping) { terminal.resize(message.cols, message.rows); emulator?.resize(message.cols, message.rows); }
    else if (message.action === 'close') stop();
  } catch (error) { send({ type: 'error', message: error.message }); stop(); }
  });
}).on('close', stop);
process.on('SIGTERM', stop); process.on('SIGINT', stop);
