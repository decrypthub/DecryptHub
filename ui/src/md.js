import { marked } from 'marked';
import hljs from 'highlight.js';
import { neutralizeHtml } from './sanitize.js';

marked.setOptions({ breaks: true, gfm: true });
const attribute = value => String(value || '').replace(/[&"<>]/g, c => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' }[c]));
marked.use({ renderer: {
  link({ href, title, tokens }) {
    const label = this.parser.parseInline(tokens), target = String(href || '').trim();
    if (/[\x00-\x1f\x7f]/.test(target) || (/^[a-z][\w+.-]*:/i.test(target) && !/^(?:https?:|file:|[a-z]:[\\/])/i.test(target))) return label;
    return '<a href="' + attribute(target) + '"' + (title ? ' title="' + attribute(title) + '"' : '') + '>' + label + '</a>';
  },
  // 兜底：正文里的 ![说明](image:<附件id>) 正常由 reply-markdown.jsx 先切段，走不到这里。
  // 但文档面板、压缩摘要等其它 Markdown 入口可能带上同样的语法，所以这里保证它
  // 永远不会变成 <img src="image:...">（坏图）——只留一个带 id 的占位标记。
  // 其余图片（含 data: 与相对路径）继续走 marked 的默认渲染，不受影响。
  image(token) {
    const href = String(token.href || '').trim();
    if (!/^image:[a-f0-9-]{36}$/.test(href)) return false; // false = 用默认 renderer
    return '<span class="md-image-ref" data-image-ref="' + attribute(href.slice(6)) + '">' + attribute(token.text || '图片') + '</span>';
  },
} });

// 渲染前先把原始 HTML 中和掉：结果经 dangerouslySetInnerHTML 注入，
// 而输入里混着抓包响应体/脚本片段/模型回复（见 sanitize.js 的注释）。
export function renderMd(text) {
  try { return marked.parse(neutralizeHtml(text), { async: false }); }
  catch { return (text || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
}
export function markdownTokens(text) { return marked.lexer(neutralizeHtml(text)); }
export function renderMarkdownToken(token, links) {
  const tokens = [token]; tokens.links = links || {};
  return marked.parser(tokens, { ...marked.defaults, async: false });
}
export function highlightLine(text, language) {
  try { if (language && hljs.getLanguage(language)) return hljs.highlight(text, { language, ignoreIllegals: true }).value; } catch {}
  return text.replace(/[&<>]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[character]));
}
export function highlightHtml(root) {
  if (!root) return;
  root.querySelectorAll('pre code:not(.hljs)').forEach(el => { try { hljs.highlightElement(el); } catch {} });
}
