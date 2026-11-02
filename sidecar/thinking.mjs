// 思考强度（thinking / reasoning effort）：渠道里「这个模型支持哪些档位、默认哪一档、怎么发给端点」的唯一事实来源。
//
// 现状：过去这里的「思考」只处理接收侧（providers/*.mjs 解析 reasoning_content / thinking_delta 并渲染），
// 发送侧完全没有强度控制——除了会话标题硬编码关掉 DeepSeek thinking，其余请求从不携带任何思考参数。
// 于是同一份渠道配置下，有的模型永远不思考，有的永远满功率思考，用户既无法声明也无法选择。
//
// 四种传输方式对应四类真实端点：
//   effort  —— OpenAI 系 reasoning_effort: minimal | low | medium | high
//   budget  —— Claude 原生 thinking.budget_tokens（最小 1024，必须小于 max_tokens，且 temperature 只能为 1）
//   switch  —— DeepSeek / GLM 等的 thinking.type: enabled | disabled（只有开关，没有档位）
//   none    —— 只声明不发送：端点自己决定是否思考，界面只如实提示，选择不影响请求
//
// 本模块同时被 ui/src 直接 import（见 BASELINE「Vite 会把 node:* 打进浏览器产物」），
// 因此必须保持零 top-level import、纯函数、不触碰 llm.mjs / providers/ / secrets.mjs。

// 档位与顺序照 DeepSeek Harness 的规范升序（off → minimal → low → medium → high → xhigh → max），
// 不自造词表：DSH 的 pi-ai 目录把 xhigh / max 作为「能力基础档之上」的可选档，只在模型显式声明时出现。
// 这里同样只做声明载体——模型没声明 xhigh，界面就不会出现「极高」，也就不会把端点不认的值发出去。
export const THINKING_LEVELS = [
  { id: 'off', label: '关闭', effort: null, budget: null },
  { id: 'minimal', label: '最少', effort: 'minimal', budget: 1024 },
  { id: 'low', label: '低', effort: 'low', budget: 2048 },
  { id: 'medium', label: '中', effort: 'medium', budget: 8192 },
  { id: 'high', label: '高', effort: 'high', budget: 16000 },
  { id: 'xhigh', label: '极高', effort: 'xhigh', budget: 32000 },
  { id: 'max', label: '最高', effort: 'max', budget: 64000 },
];

export const THINKING_TRANSPORTS = [
  { id: 'effort', label: 'reasoning_effort', desc: 'OpenAI / GPT-5 系：发送强度名' },
  { id: 'budget', label: 'thinking.budget_tokens', desc: 'Claude 原生：发送思考 token 预算' },
  { id: 'switch', label: 'thinking.type', desc: 'DeepSeek / GLM 等：只能开关思考' },
  { id: 'none', label: '不发送', desc: '端点自行决定；档位只用于界面提示' },
];

export const ALL_LEVELS = THINKING_LEVELS.map(l => l.id);
const TRANSPORTS = THINKING_TRANSPORTS.map(t => t.id);
// 「基础档」= DSH 里每个推理模型都有的那一段。xhigh / max 属于可选档，只有模型显式声明才出现，
// 所以按模型名推断时绝不能带它们：猜错就会把端点不认的 reasoning_effort 发出去。
const BASE_LEVELS = ['off', 'minimal', 'low', 'medium', 'high'];
const FULL = BASE_LEVELS;
const DEFAULT_LEVEL = 'medium';

export const isThinkingLevel = value => ALL_LEVELS.includes(value);
export const thinkingLevel = id => THINKING_LEVELS.find(l => l.id === id) || null;
export const levelLabel = id => thinkingLevel(id)?.label || '';
export const transportLabel = id => THINKING_TRANSPORTS.find(t => t.id === id)?.label || '';

/** 去重并按固定顺序排列，未知值丢弃。数组、单个字符串、undefined 都接受。 */
export function normalizeThinkingLevels(value) {
  const list = Array.isArray(value) ? value : (typeof value === 'string' && value ? [value] : []);
  return ALL_LEVELS.filter(id => list.includes(id));
}

export const levelsLabel = levels => normalizeThinkingLevels(levels).map(levelLabel).join(' / ');

/**
 * 归一一个模型的思考声明。
 * `levels` 是用户声明的「该模型支持哪些档位」——这是本功能的核心，必须可读可编辑；
 * `default` 必须落在 levels 内；`transport` 决定请求怎么发。
 * 声明为空时保留 transport，方便用户先选发送方式再选档位。
 *
 * 手写 `{ transport, level }` 也接受：等价于「只支持这一档，默认就是它」。
 * 手工编辑 settings.json 时这是最自然的写法，不该被当成空声明再被推断覆盖。
 */
export function normalizeThinking(value, fallbackTransport = 'effort') {
  const raw = value && typeof value === 'object' ? value : {};
  const shortcut = isThinkingLevel(raw.level) ? [raw.level] : [];
  const levels = normalizeThinkingLevels([...(Array.isArray(raw.levels) ? raw.levels : []), ...shortcut]);
  const transport = TRANSPORTS.includes(raw.transport) ? raw.transport : (TRANSPORTS.includes(fallbackTransport) ? fallbackTransport : 'effort');
  const fallback = levels.includes(raw.default) ? raw.default : (levels.includes(DEFAULT_LEVEL) ? DEFAULT_LEVEL : (levels[0] || ''));
  return { levels, default: fallback, transport };
}

/**
 * 用户没声明时的兜底推断（老 settings.json、测试夹具、命令行环境都走这里）。
 * 只按模型名选「明显的」几类，认不出来就声明为不发送——宁可如实说「不知道」，也不假装支持。
 */
export function inferThinking(modelId) {
  const m = String(modelId || '').toLowerCase();
  if (/claude|anthropic/.test(m)) return normalizeThinking({ levels: FULL, default: 'medium', transport: 'budget' }, 'budget');
  // OpenAI 的 o 系与 gpt-5 系认 reasoning_effort；gpt-4o 等老模型没有该参数。
  if (/^(?:o[1-9]|gpt-5)/.test(m) || /(?:^|\/)(?:o[1-9]|gpt-5)/.test(m)) return normalizeThinking({ levels: FULL, default: 'medium', transport: 'effort' }, 'effort');
  // DeepSeek V4 / Flash、GLM、Qwen 的思考开关。
  if (/deepseek[-_/](?:v[4-9]|flash|reasoner)|deepseek-r1|\bglm[-_ ]?(?:4\.[5-9]|[5-9])|qwq/.test(m)) return normalizeThinking({ levels: ['off', 'high'], default: 'high', transport: 'switch' }, 'switch');
  // 认不出来就声明「不支持可配置档位」：不假装支持，也不给出一个没有意义的默认档。
  return normalizeThinking({ levels: [], default: '', transport: 'none' }, 'none');
}

/** 生效声明：用户显式声明优先，否则按模型名推断。 */
export function modelThinking(declared, modelId) {
  const value = normalizeThinking(declared);
  return value.levels.length ? value : inferThinking(modelId);
}

/**
 * 只认用户显式声明的部分（模型配置里写了哪些档位）。
 * 与 modelThinking 的区别是这里**不推断**：推断出来的档位只用于界面，不能替用户决定发送参数。
 */
export function declaredThinking(declared) {
  const value = normalizeThinking(declared);
  return value.levels.length ? value : null;
}

/**
 * 一次请求真正要发出去的思考配置。
 * `requested` 是用户在界面上选的档位；不属于该模型声明范围时回落到模型默认档，再回落到空（不发参数）。
 */
export function effectiveThinking(declaration, requested) {
  const levels = declaration?.levels || [];
  const level = levels.includes(requested) ? requested : (levels.includes(declaration?.default) ? declaration.default : '');
  return { transport: declaration?.transport || 'none', level };
}

/**
 * 从 settings 解析当前请求的思考配置——**只发送用户明确表达过的意图**，这是本功能最重要的一条边界：
 *
 *   1) 模型在渠道里声明了档位  → 按声明发送（用户在设置页显式写下的支持范围）；
 *   2) 没声明、但用户在界面上选了档位 → 按模型名推断发送方式后发送（用户点了这一档）；
 *   3) 两者都没有 → 一个思考参数都不带，保持端点自己的默认行为。
 *
 * 第 3 条是刻意保留的：V4 / o 系等默认就思考的端点，如果因为「推断支持」就替用户加上参数，
 * 等于在用户没要求的情况下改变线上请求体。旧版只对会话标题硬编码关思考，正是同一个顾虑的体现。
 */
export function requestThinking(settings, type) {
  const providerId = type === 'anthropic' ? 'anthropic' : 'openai';
  const mirror = settings?.[providerId] || {};
  const requested = typeof settings?.activeModel === 'object' ? settings?.activeModel?.id : settings?.activeModel;
  const active = (settings?.providers || []).find(p => p.id === settings?.activeProviderId);
  let modelDecl = null;
  if (active && active.type === providerId) {
    const models = (active.models || []).map(m => (typeof m === 'string' ? { id: m } : m));
    const model = models.find(m => m?.id === requested) || models.find(m => m?.id === mirror.model);
    modelDecl = model?.thinking;
  }
  // 渠道里逐模型的声明优先；旧配置只有 openai/anthropic 两段时读镜像。
  const declared = declaredThinking(modelDecl) || declaredThinking(mirror.thinking);
  if (declared) return effectiveThinking(declared, settings?.activeThinking);
  // 未声明：只有当用户在界面上明确选了一档时才发送，发送方式按模型名推断。
  const chosen = settings?.activeThinking;
  if (!isThinkingLevel(chosen)) return { transport: 'none', level: '' };
  const inferred = inferThinking(mirror.model || requested);
  return inferred.transport === 'none' ? { transport: 'none', level: '' } : { transport: inferred.transport, level: chosen };
}

/** 档位 → reasoning_effort；关闭档与未知档返回 null（不附加该参数）。 */
export const reasoningEffort = level => thinkingLevel(level)?.effort || null;

/** 档位 → thinking.budget_tokens；关闭档与未知档返回 null。 */
export const thinkingBudget = level => thinkingLevel(level)?.budget || null;

/**
 * 界面上如实显示「这一档会往请求里放什么」。
 * 选择器不能只写「更聪明」——用户需要知道自己的选择到底改了什么，以及有没有真的发出去。
 */
export function payloadLabel(transport, level) {
  if (!isThinkingLevel(level)) return '不发送思考参数';
  if (transport === 'none') return '不发送思考参数';
  if (transport === 'budget') {
    const budget = thinkingBudget(level);
    return budget ? `thinking.budget_tokens: ${budget}` : '不发送思考参数';
  }
  if (transport === 'switch') return `thinking.type: ${level === 'off' ? 'disabled' : 'enabled'}`;
  const effort = reasoningEffort(level);
  return effort ? `reasoning_effort: ${effort}` : '不发送思考参数';
}

/**
 * OpenAI 兼容端点的思考参数片段 `{ field, value }`，没有可发的内容时返回 null。
 * 会话标题这类元数据请求永远不花思考预算：开关型端点显式关闭，强度型端点一律不附加强度。
 */
export function openAIThinking({ transport, level, requestPurpose } = {}) {
  if (requestPurpose === 'session-title') return transport === 'switch' ? { field: 'thinking', value: { type: 'disabled' } } : null;
  if (transport === 'none' || !isThinkingLevel(level)) return null;
  if (transport === 'switch') return { field: 'thinking', value: { type: level === 'off' ? 'disabled' : 'enabled' } };
  if (transport !== 'effort') return null;
  const effort = reasoningEffort(level);
  return effort ? { field: 'reasoning_effort', value: effort } : null;
}

/**
 * Claude 的 thinking.budget_tokens。返回 null 表示请求里不带 thinking 块。
 * 只有 budget 传输方式会发；off / 未知档同样不发。调用方必须同时把 temperature 设为 1
 * 并把 max_tokens 抬到 budget 之上，否则端点会直接 400（见 providers/anthropic.mjs）。
 * 会话标题与 OpenAI 侧对称：元数据请求不花思考预算。
 */
export function anthropicThinking({ transport, level, requestPurpose } = {}) {
  if (requestPurpose === 'session-title') return null;
  if (transport !== 'budget') return null;
  return thinkingBudget(level);
}
