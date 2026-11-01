import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { atomicJson } from './paths.mjs';

// 桌面版只使用 WDH 自带的 CloakBrowser 内核。系统 Chrome / 自定义路径 / GitHub Release /
// Chrome for Testing 不再作为选项：load 与 save 都归一到这里，旧的 settings.json 会被静默迁移。
export const KERNEL = 'cloak';

const DEFAULTS = {
  provider: 'openai',
  openai: { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o' },
  anthropic: { baseUrl: 'https://api.anthropic.com', apiKey: '', model: 'claude-sonnet-4-5' },
  temperature: 0.2, maxSteps: 0, tokenBudget: 0, runLimitsVersion: 1, maxTokens: 4096,
  antiDebug: false, headless: false, chromePath: '', isolated: false, proxy: '',
  // 浏览器显示方式：auto = Windows 有头时嵌入真实 Chrome 窗口，其它平台/无头用 screencast；embedded / screencast 强制
  embedMode: 'auto',
  kernel: KERNEL, // 固定 CloakBrowser；下载由 WDH 组件写入 kernels/cloak.json
  compactAt: 0.85, // 自动压缩阈值（占上下文窗口比例）；窗口本身随模型保存在 openai/anthropic.contextWindow，未设置则按模型名推断
  // 用户接入的 MCP 服务（Claude Desktop 的 mcpServers 格式 + enabled/transport 扩展）
  mcpServers: {},
  subagentMaxActive: 3, // 研究子代理并发上限（1–8）
};

export function userDataDir() {
  if (process.env.DECRYPTHUB_DATA_DIR) {
    if (!path.isAbsolute(process.env.DECRYPTHUB_DATA_DIR)) throw Error('DECRYPTHUB_DATA_DIR must be absolute');
    const directory = path.resolve(process.env.DECRYPTHUB_DATA_DIR); fs.mkdirSync(directory, { recursive: true }); return directory;
  }
  const base = process.platform === 'win32' ? (process.env.APPDATA || os.homedir())
    : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support')
    : (process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'));
  const d = path.join(base, 'WebDecryptHub');
  const legacy = path.join(base, 'JSReverseAgent');
  try { if (!fs.existsSync(d) && fs.existsSync(legacy)) fs.renameSync(legacy, d); } catch {}
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function file() { return path.join(userDataDir(), 'settings.json'); }
function enc(s) { return s ? 'b64:' + Buffer.from(s).toString('base64') : ''; }
function dec(s) { if (!s) return ''; return s.startsWith('b64:') ? Buffer.from(s.slice(4), 'base64').toString() : s; }

export function load() {
  let raw = {};
  // 去掉 BOM：用记事本/PowerShell 5.1 的 Set-Content -Encoding utf8 写的文件会带 BOM，
  // 直接 JSON.parse 会失败——而这里的 catch 会把失败吞掉，表现为「设置全丢、回到默认值」。
  try { raw = JSON.parse(fs.readFileSync(file(), 'utf8').replace(/^\uFEFF/, '')); } catch {}
  const s = { ...DEFAULTS, ...raw, openai: { ...DEFAULTS.openai, ...(raw.openai || {}) }, anthropic: { ...DEFAULTS.anthropic, ...(raw.anthropic || {}) } };
  // The old default of 40 was an implicit product limit, not a user budget.
  if (!raw.runLimitsVersion && Number(raw.maxSteps) === 40) s.maxSteps = 0;
  s.runLimitsVersion = 1;
  s.maxSteps = Number.isFinite(Number(s.maxSteps)) ? Math.max(0, Math.floor(Number(s.maxSteps))) : 0;
  s.tokenBudget = Number.isFinite(Number(s.tokenBudget)) ? Math.max(0, Math.floor(Number(s.tokenBudget))) : 0;
  // 迁移：旧版全局 contextWindow → 当前 provider 的模型配置
  if (Number(s.contextWindow) >= 4000) { const k = s.provider === 'anthropic' ? 'anthropic' : 'openai'; if (!s[k].contextWindow) s[k].contextWindow = Number(s.contextWindow); }
  delete s.contextWindow;
  s.openai.apiKey = dec(s.openai.apiKey); s.anthropic.apiKey = dec(s.anthropic.apiKey);
  if (process.env.JSRA_OPENAI_BASE) { s.provider = 'openai'; s.openai.baseUrl = process.env.JSRA_OPENAI_BASE; if (process.env.JSRA_OPENAI_KEY) s.openai.apiKey = process.env.JSRA_OPENAI_KEY; if (process.env.JSRA_OPENAI_MODEL) s.openai.model = process.env.JSRA_OPENAI_MODEL; }
  if (s.provider !== 'openai' && s.provider !== 'anthropic') s.provider = 'openai'; // 旧版 mock 设置迁移
  if (s.openai.model === 'mock') s.openai.model = '';
  if (process.env.JSRA_HEADLESS) s.headless = process.env.JSRA_HEADLESS === '1';
  if (!['auto', 'embedded', 'screencast', 'docked'].includes(s.embedMode)) s.embedMode = 'auto';
  // 内核不再可配：旧配置里的 system / bundled / github / custom 一律迁移为 CloakBrowser，
  // 自定义路径与 Chrome for Testing 记录同时清掉，避免旧路径继续被引用。
  s.kernel = KERNEL;
  s.chromePath = '';
  if (process.env.JSRA_EMBED_MODE) s.embedMode = process.env.JSRA_EMBED_MODE;
  if (!s.mcpServers || typeof s.mcpServers !== 'object' || Array.isArray(s.mcpServers)) s.mcpServers = {};
  s.subagentMaxActive = Math.min(8, Math.max(1, Math.floor(Number(s.subagentMaxActive) || 3)));
  return s;
}
// 是否以原生子窗口嵌入（仅 Windows + 有头）。纯函数，便于单元测试
export function wantEmbed(s, platform = process.platform, env = process.env) {
  if (s.headless || s.embedMode === 'screencast') return false;
  if (platform === 'win32') return true;
  // Linux 需要 X11（Wayland 会话下 Chrome 以 --ozone-platform=x11 跑在 XWayland 上）
  if (platform === 'linux') return !!env.DISPLAY && !env.JSRA_NO_EMBED;
  return false; // macOS 等：清晰 screencast
}
export function browserPresentation(settings, platform = process.platform, env = process.env) {
  const embed = wantEmbed(settings, platform, env);
  // macOS 没有原生子窗口：用有头窗口停靠到面板矩形（伪嵌入），不串流、不覆盖 viewport。
  const dock = !embed && !settings.headless && platform === 'darwin' && settings.embedMode === 'docked';
  return { embed, headless: !!settings.headless || (!embed && !dock), dock };
}
export function save(s) {
  const c = JSON.parse(JSON.stringify(s));
  // 持久化边界再归一一次：界面或旧版本即使传了别的内核，也不会写回磁盘。
  c.kernel = KERNEL; c.chromePath = '';
  // 密钥不落盘，由 OS keyring/DPAPI 管理（前端注入到内存）
  c.openai.apiKey = ''; c.anthropic.apiKey = '';
  // 渠道密钥同样只在密钥库里：providers[].apiKey 以前会被原样写盘，启动时再用 keyring 回填
  if (Array.isArray(c.providers)) c.providers = c.providers.map(p => ({ ...p, apiKey: '', hasKey: undefined }));
  atomicJson(file(), c);
}
export { DEFAULTS };
