// OpenAI 兼容适配器：流式 + 工具调用 + reasoning_content 兼容。
// 返回统一形状 { content, reasoning, toolCalls, usage, finishReason }。
import { post, sleep, retryable, sseData } from './http.mjs';

export function toOpenAITools(tools) {
  return tools.map(t => ({ type: 'function', function: { name: t.name, description: (t.description || '').slice(0, 1024), parameters: t.schema || t.inputSchema || { type: 'object', properties: {} } } }));
}

// 兼容 DeepSeek 等返回 reasoning_content 的模型：推理内容单独收集（不混入正文），并在工具循环中原样回传；
// 若服务端拒绝消息中的 reasoning_content（部分官方 reasoner 会 400），自动剥离后重试。
export async function completeOpenAI(cfg, messages, tools, { onDelta, onReasoning, signal } = {}) {
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey };
  let stripReasoning = false, useStreamOpts = true;
  for (let attempt = 0; ; attempt++) {
    const msgs = messages.map(m => {
      if (m.role !== 'assistant') return m;
      const { reasoning_content, ...rest } = m;
      return (!stripReasoning && reasoning_content) ? { ...rest, reasoning_content } : rest;
    });
    const body = { model: cfg.model, messages: msgs, stream: true, temperature: cfg.temperature ?? 0.2 };
    if (cfg.maxTokens) body.max_tokens = cfg.maxTokens;
    // V4 thinking is on by default and can exhaust a short title's output budget.
    // This documented switch applies only to metadata, never the user's task.
    if (cfg.requestPurpose === 'session-title' && /deepseek[-_/](?:v4|flash)/i.test(cfg.model || '')) body.thinking = { type: 'disabled' };
    if (useStreamOpts) body.stream_options = { include_usage: true };
    if (tools.length) { body.tools = toOpenAITools(tools); body.tool_choice = 'auto'; }
    let content = '', reasoning = '', usage = null, finishReason = null, emitted = false; const calls = {};
    try {
      await post(cfg.baseUrl.replace(/\/$/, '') + '/chat/completions', headers, body, line => {
        const data = sseData(line); if (!data) return;
        let j; try { j = JSON.parse(data); } catch { return; }
        if (j.error) { const e = new Error('模型返回错误: ' + (j.error.message || JSON.stringify(j.error)).slice(0, 300)); e.retryable = true; throw e; }
        if (j.usage) usage = j.usage;
        const ch = j.choices?.[0]; if (!ch) return;
        if (ch.finish_reason) finishReason = ch.finish_reason;
        const d = ch.delta; if (!d) return;
        const rc = d.reasoning_content ?? d.reasoning;
        if (rc) { reasoning += rc; onReasoning && onReasoning(rc); }
        if (d.content) { content += d.content; emitted = true; onDelta && onDelta(d.content); }
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
      if (e.status === 400 && !stripReasoning && /reasoning/i.test(msg)) { stripReasoning = true; continue; }
      if (e.status === 400 && useStreamOpts && /stream_options/i.test(msg)) { useStreamOpts = false; continue; }
      if (!emitted && attempt < 2 && retryable(e)) { await sleep((cfg.retryBaseMs ?? 2000) * (attempt + 1)); continue; }
      throw e;
    }
    const toolCalls = normalizeCalls(calls);
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
