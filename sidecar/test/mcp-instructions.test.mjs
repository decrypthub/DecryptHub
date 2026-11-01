// MCP 服务在 initialize 里返回的 instructions 必须真的进入模型上下文。
//
// 这是本轮修复的核心：McpHost 之前只取 listTools()，插件声明的设备能力对模型完全不可见，
// 于是模型把「工具列表里没有点击能力」误判成「这台手机操作不了」。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpHost, serverFingerprint } from '../mcphost.mjs';
import { systemMemoryPrompt, pluginIdFromServerName } from '../system-memory.mjs';

// 用测试文件自身位置解析：整个套件可能从仓库根或 sidecar/ 下运行，相对路径会失效。
const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const FIXTURE = path.join(FIXTURES, 'mcp-instructions-server.mjs');
const INSTRUCTIONS = 'DEVICE ACCESS: adb is the supported operator/AI channel. ATTRIBUTION: a stalled screen is not evidence of anti-debugging.';

// stdio 服务只有在配置被明确批准后才会启动；指纹把服务名也算进 spec，所以名字必须对得上。
const approved = (name, cfg) => ({ ...cfg, approvedFingerprint: serverFingerprint({ name, ...cfg }) });

test('server instructions survive the connection and reach the system memory', { timeout: 40000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-mcp-instr-'));
  const cfg = approved('decrypthub_adh', { command: process.execPath, args: [FIXTURE], enabled: true });
  const host = new McpHost({ getServers: () => ({ decrypthub_adh: cfg }), baseDir: dir });
  t.after(async () => {
    await host.close().catch(() => {});
    if (path.basename(dir).startsWith('dh-mcp-instr-')) fs.rmSync(dir, { recursive: true, force: true });
  });
  await host.apply({ restartAll: true });
  await host.start('decrypthub_adh', cfg);

  const status = host.status().find(s => s.name === 'decrypthub_adh');
  assert.equal(status.state, 'ready', '连接失败：' + status.error);
  assert.equal(status.instructions, INSTRUCTIONS, 'initialize instructions must be retained, not dropped');

  // 与 Agent.systemMemory() 相同的组装方式。
  const plugins = host.status().filter(p => p.state === 'ready' && p.instructions)
    .map(p => ({ name: p.name, id: pluginIdFromServerName(p.name), instructions: p.instructions }));
  const prompt = systemMemoryPrompt({ plugins });
  assert.match(prompt, /adb is the supported operator\/AI channel/);
  assert.match(prompt, /not evidence of anti-debugging/);
  // 识别成 adh 之后才会追加移动设备操作段。
  assert.match(prompt, /移动设备操作/);
});

test('a server without instructions leaves an empty string rather than an undefined hole', { timeout: 40000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-mcp-instr-'));
  const cfg = approved('plain', { command: process.execPath, args: [path.join(FIXTURES, 'mcp-demo-server.mjs')], enabled: true });
  const host = new McpHost({ getServers: () => ({ plain: cfg }), baseDir: dir });
  t.after(async () => {
    await host.close().catch(() => {});
    if (path.basename(dir).startsWith('dh-mcp-instr-')) fs.rmSync(dir, { recursive: true, force: true });
  });
  await host.apply({ restartAll: true });
  await host.start('plain', cfg);

  const status = host.status().find(s => s.name === 'plain');
  assert.equal(status.state, 'ready', '连接失败：' + status.error);
  assert.equal(status.instructions, '');
  // 没有 instructions 的自建服务不应污染系统记忆。
  const prompt = systemMemoryPrompt({ plugins: host.status().filter(p => p.state === 'ready' && p.instructions) });
  assert.doesNotMatch(prompt, /插件声明的环境事实/);
});

test('instructions disappear with the connection so stale device claims are not kept', { timeout: 40000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-mcp-instr-'));
  const cfg = approved('decrypthub_adh', { command: process.execPath, args: [FIXTURE], enabled: true });
  const host = new McpHost({ getServers: () => ({ decrypthub_adh: cfg }), baseDir: dir });
  t.after(async () => {
    await host.close().catch(() => {});
    if (path.basename(dir).startsWith('dh-mcp-instr-')) fs.rmSync(dir, { recursive: true, force: true });
  });
  await host.apply({ restartAll: true });
  await host.start('decrypthub_adh', cfg);
  assert.ok(host.status().find(s => s.name === 'decrypthub_adh').instructions);

  await host.stop('decrypthub_adh');
  assert.equal(host.status().find(s => s.name === 'decrypthub_adh').instructions, '');
  // 断开后系统记忆里不能再出现这台设备的能力声明。
  const prompt = systemMemoryPrompt({ plugins: host.status().filter(p => p.state === 'ready' && p.instructions) });
  assert.doesNotMatch(prompt, /移动设备操作/);
});




