// Anthropic 适配器：流式 + tool_use + extended thinking。
// usage / finishReason 归一化成 OpenAI 形状（prompt_tokens / completion_tokens / cached_tokens），
// 这样 agent 的用量统计、上下文校准和压缩阈值对两个 provider 走同一条路径。
import { post, sseData, modelStreamError } from './http.mjs';

function toAnthropicTools(tools) {
  return tools.map(t => ({ name: t.name, description: (t.description || '').slice(0, 1024), input_schema: t.schema || t.inputSchema || { type: 'object', properties: {} } }));
}

/** OpenAI 形状的 messages → Anthropic 的 system + messages（tool 结果转 tool_result block） */
export function toAnthropicMessages(messages) {
  let system = '';
  const msgs = [];
  for (const m of messages) {
    if (m.role === 'system') { system += (system ? '\n' : '') + m.content; continue; }
    if (m.role === 'tool') { msgs.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: String(m.content ?? '') }] }); continue; }
    if (m.role === 'assistant' && m.tool_calls?.length) {
      const blocks = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const tc of m.tool_calls) blocks.push({ type: 'tool_use', id: tc.id, name: tc.function?.name, input: safeJson(tc.function?.arguments) });
      msgs.push({ role: 'assistant', content: blocks });
      continue;
    }
    if (Array.isArray(m.content)) {
      const content = m.content.map(part => {
        if (part.type === 'text') return { type: 'text', text: part.text || '' };
        const match = part.type === 'image_url' && /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(part.image_url?.url || '');
        if (!match) throw new Error('图片格式无效：Anthropic 图片需要受信任的本地附件');
        return { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } };
      }).filter(b => b.type !== 'text' || b.text);
      if (content.length) msgs.push({ role: m.role, content });
      continue;
    }
    const text = String(m.content ?? '');
    if (!text) continue; // 空文本块会被 Anthropic 拒绝
    msgs.push({ role: m.role, content: text });
  }
  // 首条不能是「纯 assistant 文本」（例如压缩后的“已了解”确认）；带 tool_calls 的不能丢，否则孤儿 tool_result
  const first = msgs[0];
  if (first?.role === 'assistant' && !(Array.isArray(first.content) && first.content.some?.(b => b.type === 'tool_use'))) msgs.shift();
  return { system, messages: msgs };
}

function safeJson(s) { if (s && typeof s === 'object') return s; try { return JSON.parse(s || '{}'); } catch { return {}; } }

export async function completeAnthropic(cfg, messages, tools, { onDelta, onReasoning, signal } = {}) {
  const headers = { 'Content-Type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' };
  const { system, messages: msgs } = toAnthropicMessages(messages);
  const body = { model: cfg.model, max_tokens: cfg.maxTokens || 4096, system, messages: msgs, stream: true, temperature: cfg.temperature ?? 0.2 };
  if (tools.length) body.tools = toAnthropicTools(tools);

  for (let attempt = 0; ; attempt++) {
    let content = '', reasoning = '', completed = false;
    let inputTokens = 0, outputTokens = 0, cachedTokens = 0, finishReason = null;
    const calls = new Map();
    try {
      await post(cfg.baseUrl.replace(/\/$/, '') + '/v1/messages', headers, body, line => {
        const data = sseData(line); if (!data) return;
        let j; try { j = JSON.parse(data); } catch { return; }
        if (j.type === 'message_stop') completed = true;
        if (j.type === 'error') throw modelStreamError(j.error);
        if (j.type === 'message_start') {
          inputTokens = j.message?.usage?.input_tokens || 0;
          cachedTokens = j.message?.usage?.cache_read_input_tokens || 0;
        }
        if (j.type === 'content_block_start' && j.content_block?.type === 'tool_use') {
          calls.set(j.index, { id: j.content_block.id, name: j.content_block.name, args: '' });
        }
        if (j.type === 'content_block_delta') {
          const d = j.delta || {};
          if (d.type === 'text_delta') { content += d.text || ''; onDelta && onDelta(d.text || ''); }
          else if (d.type === 'thinking_delta' && typeof d.thinking === 'string') { reasoning += d.thinking; onReasoning && onReasoning(d.thinking); }
          else if (d.type === 'input_json_delta' && calls.has(j.index)) { calls.get(j.index).args += d.partial_json || ''; }
        }
        if (j.type === 'message_delta') {
          if (j.usage?.output_tokens != null) outputTokens = j.usage.output_tokens;
          if (j.delta?.stop_reason) finishReason = j.delta.stop_reason;
        }
      }, signal, cfg.idleTimeoutMs || 180000);
    } catch (e) {
      throw e;
    }
    const toolCalls = [...calls.values()].filter(c => c.name).map(c => {
      const raw = String(c.args || '').trim();
      if (!raw) return { id: c.id, name: c.name, args: {}, rawArgs: '' };
      try { return { id: c.id, name: c.name, args: JSON.parse(raw), rawArgs: raw }; }
      catch { return { id: c.id, name: c.name, args: {}, rawArgs: raw, argError: '工具参数不是合法 JSON：' + raw.slice(0, 200) }; }
    });
    if ((!finishReason && !completed) || (!content && !toolCalls.length)) {
      const terminal = ['max_tokens', 'refusal'].includes(finishReason);
      throw Object.assign(new Error(terminal ? `模型未输出答案（${finishReason}），请检查输出长度或服务限制` : '模型响应流未完整结束或返回空响应'), { code: 'EMPTY_COMPLETION', retryable: !terminal });
    }
    return {
      content, reasoning, toolCalls,
      usage: inputTokens || outputTokens ? { prompt_tokens: inputTokens, completion_tokens: outputTokens, prompt_tokens_details: cachedTokens ? { cached_tokens: cachedTokens } : undefined } : null,
      finishReason,
    };
  }
}
