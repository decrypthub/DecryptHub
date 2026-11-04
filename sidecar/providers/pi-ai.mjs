// Responses uses the same pinned pi-ai protocol engine as DSH's llm-pi-ai.
// The host retains ownership of credentials, history, retries and tool execution.
import crypto from 'node:crypto';
import { streamSimple } from '@earendil-works/pi-ai/api/openai-responses';
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript';
import { anthropicContent } from './content.mjs';
import { ALL_LEVELS } from '../thinking.mjs';
import { isContextOverflowError, CONTEXT_OVERFLOW } from './http.mjs';
import { catalogRoute } from '../provider-catalog.mjs';

const zeroUsage = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
const argsOf = value => { try { return JSON.parse(value || '{}'); } catch { return {}; } };
const digest = message => crypto.createHash('sha256').update(JSON.stringify([message.content || '', message.reasoning_content || '', message.tool_calls || []])).digest('hex');
const route = cfg => ({ providerId: cfg.providerId || null, model: cfg.model, baseUrl: (cfg.baseUrl || '').replace(/\/$/, ''), api: cfg.api || 'openai-responses', catalogProviderId: cfg.catalogProviderId || null });
const sameRoute = (replay, cfg) => replay?.kind === 'pi-ai' && replay.version === 1 && Object.entries(route(cfg)).every(([key, value]) => (replay[key] ?? null) === (value ?? null));
function piContent(content) {
  const converted = anthropicContent(content);
  return typeof converted === 'string' ? converted : converted.map(part => part.type === 'image'
    ? { type: 'image', mimeType: part.source.media_type, data: part.source.data } : part);
}
export function toPiContext(messages, tools, cfg) {
  const converted = [], names = new Map();
  for (const message of messages) {
    if (message.role === 'system') { converted.push({ role: 'system', content: String(message.content || ''), timestamp: 0 }); continue; }
    if (message.role === 'assistant') {
      for (const call of message.tool_calls || []) names.set(call.id, call.function?.name || 'unknown');
      const replay = message._nativeReplay;
      if (sameRoute(replay, cfg) && replay.digest === digest(message) && replay.message?.role === 'assistant' && Array.isArray(replay.message.content)) {
        converted.push(structuredClone(replay.message)); continue;
      }
      const content = [];
      if (message.reasoning_content) content.push({ type: 'thinking', thinking: message.reasoning_content });
      if (message.content) content.push({ type: 'text', text: String(message.content) });
      for (const call of message.tool_calls || []) content.push({ type: 'toolCall', id: call.id, name: call.function?.name, arguments: argsOf(call.function?.arguments) });
      if (content.length) converted.push({ role: 'assistant', api: 'decrypthub-foreign', provider: 'decrypthub-foreign', model: 'unknown', content, usage: zeroUsage(), stopReason: message.tool_calls?.length ? 'toolUse' : 'stop', timestamp: 0 });
      continue;
    }
    if (message.role === 'tool') {
      const content = piContent(message.content);
      converted.push({ role: 'toolResult', toolCallId: message.tool_call_id, toolName: message.name || names.get(message.tool_call_id) || 'unknown',
        content: typeof content === 'string' ? [{ type: 'text', text: content || '(空)' }] : content, isError: !!message._toolError, timestamp: 0 });
      continue;
    }
    converted.push({ role: 'user', content: piContent(message.content), timestamp: 0 });
  }
  return normalizeContext({ messages: converted, tools: tools.map(tool => ({ name: tool.name, description: tool.description || '', parameters: tool.schema || tool.inputSchema || { type: 'object', properties: {} } })) });
}
function nextEvent(iterator, signal, idleMs) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => settle(reject, signal.reason || Error('请求已取消'));
    const timer = setTimeout(() => settle(reject, Object.assign(Error('模型响应流长时间没有输出'), { code: 'LLM_STREAM_IDLE_TIMEOUT', retryable: true })), idleMs);
    const settle = (fn, value) => { clearTimeout(timer); signal.removeEventListener('abort', abort); fn(value); };
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => iterator.next()).then(value => settle(resolve, value), error => settle(reject, error));
    if (signal.aborted) abort();
  });
}
export async function completeResponses(cfg, messages, tools, { onDelta, onReasoning, signal } = {}) {
  // The complete route is captured before the first await, like DSH prepareCall.
  cfg = structuredClone(cfg);
  const thinking = cfg.thinking || {}, level = cfg.requestPurpose === 'session-title' || thinking.transport === 'none' ? '' : thinking.level;
  if (!cfg.catalogProviderId && level && thinking.transport !== 'effort') throw Error('Responses 接口需要按强度发送思考配置，请在模型配置中重新保存思考档位');
  const reasoning = !!level, thinkingLevelMap = Object.fromEntries(ALL_LEVELS.map(id => [id,
    cfg.thinkingLevels?.includes(id) || id === level ? Object.hasOwn(thinking.wireValues || {}, id) ? thinking.wireValues[id] : id === 'off' ? 'none' : id : null]));
  let model = { id: cfg.model, name: cfg.model, api: 'openai-responses', provider: cfg.providerId || 'decrypthub', baseUrl: (cfg.baseUrl || '').replace(/\/$/, ''),
    reasoning, input: cfg.vision ? ['text', 'image'] : ['text'], contextWindow: cfg.contextWindow || 128000, maxTokens: cfg.maxTokens || 4096,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, thinkingLevelMap,
    ...(cfg.compat ? { compat: { ...cfg.compat } } : {}) };
  const controller = new AbortController(), upstream = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const options = { ...(cfg.apiKey ? { apiKey: cfg.apiKey } : {}), maxRetries: 0, signal: upstream,
    ...(!cfg.catalogProviderId ? { env: {} } : {}),
    ...(cfg.maxTokens ? { maxTokens: cfg.maxTokens } : {}),
    ...(cfg.catalogProviderId ? { reasoning: cfg.requestPurpose === 'session-title' ? 'off' : level || 'off' } : level && level !== 'off' ? { reasoning: level } : {}),
    ...(!reasoning && cfg.temperature !== undefined ? { temperature: cfg.temperature } : {}) };
  const catalog = cfg.catalogProviderId ? catalogRoute(cfg) : null;
  if (catalog) model = catalog.model;
  const events = catalog ? catalog.models.streamSimple(model, toPiContext(messages, tools, cfg), options) : streamSimple(model, toPiContext(messages, tools, cfg), options), iterator = events[Symbol.asyncIterator]();
  let output;
  try {
    for (;;) {
      const next = await nextEvent(iterator, upstream, cfg.idleTimeoutMs || 180000); if (next.done) break;
      const event = next.value;
      if (event.type === 'text_delta') onDelta?.(event.delta);
      if (event.type === 'thinking_delta') onReasoning?.(event.delta);
      if (event.type === 'done') output = event.message;
      if (event.type === 'error') {
        const error = Error(event.error?.errorMessage || '模型响应流未完成');
        const status = /(?:^|\D)([45]\d\d)(?:\D|$)/.exec(error.message)?.[1];
        if (status) error.status = Number(status);
        if (isContextOverflowError(error)) error.code = CONTEXT_OVERFLOW;
        throw error;
      }
    }
    if (!output) throw Object.assign(Error('模型响应流未完整结束'), { code: 'EMPTY_COMPLETION', retryable: true });
    const content = output.content.filter(block => block.type === 'text').map(block => block.text).join('');
    const reasoningText = output.content.filter(block => block.type === 'thinking').map(block => block.thinking).join('');
    const toolCalls = output.content.filter(block => block.type === 'toolCall').map(block => ({ id: block.id, name: block.name, args: block.arguments,
      rawArgs: JSON.stringify(block.arguments), ...(block.argumentsError ? { argError: block.argumentsError } : {}) }));
    if (!content && !toolCalls.length) throw Object.assign(Error('模型没有输出可用答案'), { code: 'EMPTY_COMPLETION', retryable: output.stopReason !== 'length' });
    const usage = output.usage || zeroUsage();
    const wire = { content, reasoning_content: reasoningText, tool_calls: toolCalls.length ? toolCalls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } })) : [] };
    return { content, reasoning: reasoningText, toolCalls, finishReason: ({ toolUse: 'tool_calls' })[output.stopReason] || output.stopReason,
      usage: { prompt_tokens: usage.input + usage.cacheRead + usage.cacheWrite, completion_tokens: usage.output,
        prompt_tokens_details: { cached_tokens: usage.cacheRead }, completion_tokens_details: { reasoning_tokens: usage.reasoning || 0 } },
      nativeReplay: { kind: 'pi-ai', version: 1, ...route(cfg), digest: digest(wire), message: structuredClone(output) } };
  } finally { controller.abort(); void iterator.return?.()?.catch?.(() => {}); }
}
