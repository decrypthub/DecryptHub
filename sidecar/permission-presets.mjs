// 权限预设：一个预设 = 「访问边界 mode」+「审批方式 review」两个旋钮的捆绑。
//
// 对应 DeepSeek Harness 的 `@deepseek-ai/dsh-permission-presets`
// （../deepseek-harness/packages/interaction/permission-presets/src/index.ts）。读代码得到的三条规则：
//
//   1. 预设表只有三档，顺序固定：read-only / workspace-write / danger-full-access。
//   2. 旋钮组合不匹配任何预设时，推导出 `custom`（CUSTOM_PRESET）。它**可以**作为当前值显示，
//      但永远不是可选行、不是切换目标、不写进任何事件。
//   3. 切换只改「有效值真的变了」的旋钮；净变化为零时不写任何东西。
//
// 为什么 DecryptHub 不需要 DSH 的 `permission/preset` 事件：
// 那边两个预设可以共享同一组旋钮（danger-full-access+never 与 auto 的审批策略相同），
// 所以要额外记一条「用户其实选了哪个」。这里 (mode, review) 与预设一一对应
// （见 presetKnobs），当前值完全可由旋钮推导，多一条事件只会引入两处真相。
//
// 本模块零顶层 import：UI（`ui/src`）与 sidecar 都要用它，一旦引入 `node:*` 或
// `./llm.mjs`，Vite 会把 Node 内置模块打进浏览器产物（见 BASELINE「坑 0」）。

/** 三档预设，顺序与 DSH 的 presets 表一致。`label` 是 DSH 的同款文案。 */
export const PERMISSION_PRESETS = Object.freeze([
  Object.freeze({
    id: 'read-only',
    label: '仅可查看',
    description: '只能读取工作区文件与页面；写入、执行代码和远程修改会被直接拒绝，也不会弹出确认。',
  }),
  Object.freeze({
    id: 'workspace-write',
    label: '工作区内修改',
    description: '可在工作区内读写文件；隔离范围之外的执行、联网与浏览器交互需要你逐次确认。',
  }),
  Object.freeze({
    id: 'full-access',
    label: '完全权限',
    description: '文件、命令、浏览器及已启用工具直接执行，不再逐次确认。',
  }),
]);

/**
 * 旋钮组合不匹配任何预设时的推导值（DSH 的 `CUSTOM_PRESET`）。
 * DecryptHub 里唯一会出现的这类状态是「标准边界 + 规则自动批准」（review=auto）：
 * 它比三档都窄，不能冒充任何一档，所以只作为当前值显示。
 */
export const CUSTOM_PRESET = 'custom';

/** 需要勾选风险确认才能启用的预设；与 DSH 的 FULL_ACCESS_PRESET 一致。 */
export const FULL_ACCESS_PRESET = 'full-access';

/** 不可选状态的显示名。DSH 把 `custom` 显示为 "Custom"，这里显示成它实际是什么。 */
export const CUSTOM_PRESET_LABEL = '自动批准';

/** `/permission` 的对外预设名（DSH 的 machine value），顺序即提示里的列出顺序。 */
export const PRESET_CLI_NAMES = Object.freeze(['read-only', 'workspace-write', 'danger-full-access']);

/**
 * 由两个旋钮推导当前预设。顺序有语义：先判审批方式，再判访问边界——
 * review=auto 与任何预设的审批方式都不同，不能因为 mode 是 standard 就归到「工作区内修改」。
 * @param {string} mode 访问边界：read-only | standard | full-access
 * @param {string} review 审批方式：manual | auto
 * @returns {string} 三档之一，或 {@link CUSTOM_PRESET}
 */
export function currentPreset(mode, review) {
  if (review === 'auto') return CUSTOM_PRESET;
  if (mode === 'full-access') return 'full-access';
  if (mode === 'read-only') return 'read-only';
  return 'workspace-write';
}

/**
 * 预设的显示名。`custom` 也必须有名，否则 trigger 会空着或被回退成错误的一档。
 * @param {string} id 预设 id 或 {@link CUSTOM_PRESET}
 * @returns {string} 用户可读的名字
 */
export function presetLabel(id) {
  if (id === CUSTOM_PRESET) return CUSTOM_PRESET_LABEL;
  return PERMISSION_PRESETS.find(p => p.id === id)?.label || PERMISSION_PRESETS[1].label;
}

/**
 * 预设的一句话说明，用作 trigger 的 title（DSH 把说明放在 title，菜单行里只有标签）。
 * @param {string} id 预设 id 或 {@link CUSTOM_PRESET}
 * @returns {string} 说明文字
 */
export function presetDescription(id) {
  if (id === CUSTOM_PRESET) return '标准边界 + 规则自动批准：隔离执行器内、禁用安装脚本、仅访问官方 npm registry 的依赖安装直接放行，其余仍然逐次确认。';
  return PERMISSION_PRESETS.find(p => p.id === id)?.description || '';
}

/**
 * 选中某个预设要写入的两个旋钮。
 * 两个旋钮总是成对下发：当前档位完全由它们推导，只写一半会让推导落到错误的预设上。
 * @param {string} id 预设 id
 * @returns {{ mode: string, review: string }} 可直接交给 session-set-mode 的参数
 */
export function presetKnobs(id) {
  const mode = id === 'read-only' ? 'read-only' : id === 'full-access' ? 'full-access' : 'standard';
  return { mode, review: 'manual' };
}

/**
 * 解析用户键入的预设名。同时接受 DSH 的 machine value 与 DecryptHub 的历史叫法：
 * `standard` 是 workspace-write 的旧内部名，`full-access` 是 danger-full-access 的旧内部名。
 * @param {string} name 用户键入的名字
 * @returns {string|undefined} 内部预设 id；未知名字返回 undefined，由调用方报错
 */
export function resolvePreset(name) {
  const key = String(name ?? '').trim().toLowerCase();
  if (key === 'read-only') return 'read-only';
  if (key === 'workspace-write' || key === 'standard') return 'workspace-write';
  if (key === 'danger-full-access' || key === 'full-access') return 'full-access';
  return undefined;
}

/**
 * 内部预设 id → `/permission` 使用的对外名。提示与回执都用对外名，
 * 否则用户看到的是内部旋钮值（`standard`），跟界面上「工作区内修改」对不上。
 * @param {string} id 内部预设 id 或 `custom`
 * @returns {string} 对外名
 */
export function presetCliName(id) {
  if (id === 'workspace-write') return 'workspace-write';
  if (id === 'read-only') return 'read-only';
  if (id === 'full-access') return 'danger-full-access';
  return CUSTOM_PRESET;
}

/** 裸 `/permission` 的提示行，形状与 DSH 的 `current preset X (available: ...)` 一致。 */
export function presetStatusLine(id) {
  return `当前预设 ${presetCliName(id)}（可用：${PRESET_CLI_NAMES.join('、')}）`;
}
