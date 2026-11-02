// OpenAI 兼容适配器：流式 + 工具调用 + reasoning_content 兼容。
// 返回统一形状 { content, reasoning, toolCalls, usage, finishReason }。
import { post, sseData, modelStreamError } from './http.mjs';
import { openAIThinking } from '../thinking.mjs';

export function toOpenAITools(tools) {
  return tools.map(t => ({ type: 'function', function: { name: t.name, description: (t.description || '').slice(0, 1024), parameters: t.schema || t.inputSchema || { type: 'object', properties: {} } } }));
}

// 兼容 DeepSeek 等返回 reasoning_content 的模型：推理内容单独收集（不混入正文），并在工具循环中原样回传；
// 若服务端拒绝消息中的 reasoning_content（部分官方 reasoner 会 400），自动剥离后重试。
export async function completeOpenAI(cfg, messages, tools, { onDelta, onReasoning, signal } = {}) {
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey };
  let stripReasoning = false, useStreamOpts = true, dropThinking = false, dropEffort = false;
  for (let attempt = 0; ; attempt++) {
    const msgs = messages.map(m => {
      if (m.role !== 'assistant') return m;
      const { reasoning_content, ...rest } = m;
      return (!stripReasoning && reasoning_content) ? { ...rest, reasoning_content } : rest;
    });
    const body = { model: cfg.model, messages: msgs, stream: true, temperature: cfg.temperature ?? 0.2 };
    if (cfg.maxTokens) body.max_tokens = cfg.maxTokens;
    // 思考参数由端点协议自动决定（见 deriveTransport）：强度 → reasoning_effort，
    // 开关型 → thinking.type（开启时再叠加 reasoning_effort 表达「开多大」），未声明 → 一个都不发。
    const thinking = openAIThinking({ ...(cfg.thinking || {}), requestPurpose: cfg.requestPurpose })
      .filter(({ field }) => !dropThinking && !(dropEffort && field === 'reasoning_effort'));
    for (const { field, value } of thinking) body[field] = value;
    // 会话标题是元数据，不该花思考预算：DeepSeek V4 默认思考，会把 256 token 的标题预算吃光。
    // 这条与会话标题的思考声明无关，是独立保护，所以在这里兜底而不是塞进 openAIThinking。
    if (cfg.requestPurpose === 'session-title' && /deepseek[-_/](?:v4|flash)|deepseek[-_/]reasoner|deepseek-r1/i.test(cfg.model || '') && body.thinking === undefined) body.thinking = { type: 'disabled' };
    if (useStreamOpts) body.stream_options = { include_usage: true };
    if (tools.length) { body.tools = toOpenAITools(tools); body.tool_choice = 'auto'; }
    let content = '', reasoning = '', usage = null, finishReason = null, completed = false; const calls = {};
    try {
      await post(cfg.baseUrl.replace(/\/$/, '') + '/chat/completions', headers, body, line => {
        if (/^data:\s*\[DONE\]\s*$/.test(line)) completed = true;
        const data = sseData(line); if (!data) return;
        let j; try { j = JSON.parse(data); } catch { return; }
        if (j.error) throw modelStreamError(j.error);
        if (j.usage) usage = j.usage;
        const ch = j.choices?.[0]; if (!ch) return;
        if (ch.finish_reason) finishReason = ch.finish_reason;
        const d = ch.delta; if (!d) return;
        const rc = d.reasoning_content ?? d.reasoning;
        if (typeof rc === 'string' && rc) { reasoning += rc; onReasoning && onReasoning(rc); }
        if (d.content) { content += d.content; onDelta && onDelta(d.content); }
        for (const tc of d.tool_calls || []) {
          const idx = tc.index ?? 0;
          calls[idx] = calls[idx] || { id: tc.id, name: '', args: '' };
          if (tc.id) calls[idx].id = tc.id;
          if (tc.function?.name) calls[idx].name += tc.function.name;
          if (tc.function?.arguments) calls[idx].args += tc.function.arguments;
        }
      }, signal, cfg.idleTimeoutMs || 180000);
    } catch (e) {
      const msg = String(e.message || e);
      // 端点不认思考参数（老模型 / 中转未透传）：去掉参数重试，而不是让整个请求失败。
      // 两个字段分开剥：开关型端点的常见失败是「只认 thinking.type，不认 reasoning_effort」，
      // 一刀切会把能用的那一半也扔掉，等于悄悄降级成「开/关」而不告诉任何人。
      // 必须先于下面那条判定——"reasoning_effort" 也含 reasoning，否则会被误判成「消息里禁止 reasoning_content」。
      if (e.status === 400 && !dropEffort && thinking.some(t => t.field === 'reasoning_effort') && /reasoning_effort|\beffort\b/i.test(msg)) { dropEffort = true; continue; }
      if (e.status === 400 && !dropThinking && thinking.some(t => t.field === 'thinking') && /thinking/i.test(msg)) { dropThinking = true; continue; }
      if (e.status === 400 && !stripReasoning && /reasoning/i.test(msg)) { stripReasoning = true; continue; }
      if (e.status === 400 && useStreamOpts && /stream_options/i.test(msg)) { useStreamOpts = false; continue; }
      throw e;
    }
    const toolCalls = normalizeCalls(calls);
    if ((!finishReason && !completed) || (!content && !toolCalls.length)) {
      const terminal = ['length', 'content_filter', 'refusal'].includes(finishReason);
      throw Object.assign(new Error(terminal ? `模型未输出答案（${finishReason}），请检查输出长度或服务限制` : '模型响应流未完整结束或返回空响应'), { code: 'EMPTY_COMPLETION', retryable: !terminal });
    }
    return { content, reasoning, toolCalls, usage, finishReason };
  }
}

/** 增量累积的 tool_calls → 统一结构（参数不是合法 JSON 时不抛错，交给循环回喂模型） */
export function normalizeCalls(calls) {
  return Object.values(calls).filter(c => c && c.name).map(c => {
    const id = c.id || 'call_' + Math.random().toString(36).slice(2);
    const raw = String(c.args || '').trim();
    if (!raw) return { id, name: c.name, args: {}, rawArgs: '' };
    try { return { id, name: c.name, args: JSON.parse(raw), rawArgs: raw }; }
    catch { return { id, name: c.name, args: {}, rawArgs: raw, argError: '工具参数不是合法 JSON：' + raw.slice(0, 200) }; }
  });
}
