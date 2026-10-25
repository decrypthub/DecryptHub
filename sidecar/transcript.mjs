// Export persisted conversation data. No provider config, system prompt or hidden
// reasoning is part of the sharing format; archived tool references stay intact.
function fence(value, language = '') {
  const text = String(value ?? ''); let longest = 0;
  for (const run of text.matchAll(/`+/g)) longest = Math.max(longest, run[0].length);
  const marks = '`'.repeat(Math.max(3, longest + 1));
  return `${marks}${language}\n${text}\n${marks}`;
}
const inline = value => String(value || '').replace(/[\r\n`]/g, ' ');
const html = value => String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function conversationMarkdown({ id, title, events = [] }) {
  const out = [`# ${String(title || '对话').replace(/[\r\n]/g, ' ')}`, `会话 ID：\`${inline(id)}\``];
  for (const event of events) {
    if (event.t === 'user') {
      const raw = String(event.content || '');
      if (/^【(?:系统|运行提示|工作区已切换)】/.test(raw) && event.displayContent == null) continue;
      const text = event.displayContent ?? raw.replace(/\n\n【当前状态】[\s\S]*$/, '');
      out.push('## 用户', String(text || '（仅附件）'));
      for (const attachment of event.attachments || []) out.push(`- 附件：${inline(attachment.name || attachment.label || attachment.file || attachment.id || attachment.kind)}${attachment.id ? `（ID：\`${inline(attachment.id)}\`）` : ''}`);
      if (event.turnId) out.push(`> 运行 ID：\`${inline(event.turnId)}\``);
    } else if (event.t === 'assistant') {
      if (event.content) out.push(event.phase === 'partial_answer' ? '## AI · 尚未完成' : event.phase === 'commentary' || event.calls?.length ? '### AI · 执行过程' : '## AI', String(event.content));
      for (const call of event.calls || []) {
        const args = typeof call.args === 'string' ? call.args : JSON.stringify(call.args || {}, null, 2);
        out.push(`<details>\n<summary>工具调用：${html(call.name)}</summary>\n\n调用 ID：\`${inline(call.itemId || call.id)}\`\n\n${fence(args, 'json')}\n\n</details>`);
      }
    } else if (event.t === 'tool') {
      out.push(`<details>\n<summary>工具结果：${html(event.name || '工具')}${event.isError ? ' · 失败' : ''}</summary>\n\n调用 ID：\`${inline(event.itemId || event.id)}\`\n\n${fence(event.content)}\n\n</details>`);
    } else if (event.t === 'summary') out.push('## 上下文检查点', String(event.content || ''));
    else if (event.t === 'turn-end') out.push(`> 运行结束：${inline(event.stop || 'unknown')} · 运行 ID：\`${inline(event.turnId)}\``);
  }
  return out.join('\n\n') + '\n';
}
