import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { atomicJson } from './paths.mjs';
import { normalizeTitlePrefix } from './session-titles.mjs';
import { normalizeThinking, ALL_LEVELS } from './thinking.mjs';

// 桌面版只使用 WDH 自带的 CloakBrowser 内核。系统 Chrome / 自定义路径 / GitHub Release /
// Chrome for Testing 不再作为选项：load 与 save 都归一到这里，旧的 settings.json 会被静默迁移。
export const KERNEL = 'cloak';

// 应用数据目录名 = 产品名。不要写成 WebDecryptHub：那是浏览器组件 WDH 的仓库名，不是本产品。
export const DATA_DIR_NAME = 'DecryptHub';
// 旧目录名，按从新到旧排列；只在 DATA_DIR_NAME 不存在时逐个前移迁移。
export const LEGACY_DATA_DIR_NAMES = ['WebDecryptHub', 'JSReverseAgent'];

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
  // 会话标题前缀：纯展示配置，渲染时拼在标题前，不写入任何 title 字段（见 session-titles.mjs）
  titlePrefix: '',
  // 用户接入的 MCP 服务（Claude Desktop 的 mcpServers 格式 + enabled/transport 扩展）
  mcpServers: {},
  subagentMaxActive: 3, // 研究子代理并发上限（1–8）
  // 当前渠道下选中的思考强度：空串表示跟随模型声明，由 thinking.mjs 解析成合法档位后发送
  activeThinking: '',
};

export function userDataDir() {
  if (process.env.DECRYPTHUB_DATA_DIR) {
    if (!path.isAbsolute(process.env.DECRYPTHUB_DATA_DIR)) throw Error('DECRYPTHUB_DATA_DIR must be absolute');
    const directory = path.resolve(process.env.DECRYPTHUB_DATA_DIR); fs.mkdirSync(directory, { recursive: true }); return directory;
  }
  const base = process.platform === 'win32' ? (process.env.APPDATA || os.homedir())
    : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support')
    : (process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'));
  // 产品正式名是 DecryptHub。目录名历史上的演变是 JSReverseAgent → WebDecryptHub → DecryptHub，
  // 每次只往前挪一格，且只在目标不存在时搬，避免把用户刚建的空目录当成"已迁移"而丢数据。
  const d = path.join(base, DATA_DIR_NAME);
  for (const name of LEGACY_DATA_DIR_NAMES) {
    const legacy = path.join(base, name);
    try { if (!fs.existsSync(d) && fs.existsSync(legacy)) fs.renameSync(legacy, d); } catch {}
  }
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
  // 会话标题前缀只影响展示：归一（去控制字符/折叠空白/截断），脏值回落成不显示前缀。
  s.titlePrefix = normalizeTitlePrefix(s.titlePrefix);
  // 思考强度：脏值回落成空串（跟随模型声明），避免把非法档位发到端点。
  // 注意只在模型**已有声明**时归一，不给未配置的模型凭空写入声明——那会改变线上请求体。
  if (process.env.JSRA_THINKING && ALL_LEVELS.includes(process.env.JSRA_THINKING)) s.activeThinking = process.env.JSRA_THINKING;
  else if (!ALL_LEVELS.includes(s.activeThinking)) s.activeThinking = '';
  const keepThinking = (value, fallback) => (value && typeof value === 'object' ? normalizeThinking(value, fallback) : value);
  if (Array.isArray(s.providers)) s.providers = s.providers.map(p => ({ ...p, models: (p.models || []).map(m => m && typeof m === 'object' && m.thinking != null ? { ...m, thinking: normalizeThinking(m.thinking, p.type === 'anthropic' ? 'budget' : 'effort') } : m) }));
  // 旧的 openai/anthropic 两段镜像同理：有声明才归一。
  for (const type of ['openai', 'anthropic']) if (s[type] && typeof s[type] === 'object') s[type].thinking = keepThinking(s[type].thinking, type === 'anthropic' ? 'budget' : 'effort');
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
  // 前缀同样在落盘前归一，避免界面传入超长/带控制字符的值之后 load() 才被动纠正。
  c.titlePrefix = normalizeTitlePrefix(c.titlePrefix);
  // 思考强度同样在落盘前归一：界面即使传出非法档位，也不会写进 settings.json。未声明的模型保持原样。
  if (!ALL_LEVELS.includes(c.activeThinking)) c.activeThinking = '';
  if (Array.isArray(c.providers)) c.providers = c.providers.map(p => ({ ...p, models: (p.models || []).map(m => (m && typeof m === 'object' && m.thinking != null ? { ...m, thinking: normalizeThinking(m.thinking, p.type === 'anthropic' ? 'budget' : 'effort') } : m)) }));
  for (const type of ['openai', 'anthropic']) if (c[type] && typeof c[type] === 'object' && c[type].thinking != null) c[type].thinking = normalizeThinking(c[type].thinking, type === 'anthropic' ? 'budget' : 'effort');
  // 密钥不落盘，由 OS keyring/DPAPI 管理（前端注入到内存）
  c.openai.apiKey = ''; c.anthropic.apiKey = '';
  // 渠道密钥同样只在密钥库里：providers[].apiKey 以前会被原样写盘，启动时再用 keyring 回填
  if (Array.isArray(c.providers)) c.providers = c.providers.map(p => ({ ...p, apiKey: '', hasKey: undefined, authentication: undefined }));
  atomicJson(file(), c);
}
export { DEFAULTS };
