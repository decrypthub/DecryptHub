import { marked } from 'marked';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';
import { neutralizeHtml } from './sanitize.js';

marked.setOptions({ breaks: true, gfm: true });

// 渲染前先把原始 HTML 中和掉：结果经 dangerouslySetInnerHTML 注入，
// 而输入里混着抓包响应体/脚本片段/模型回复（见 sanitize.js 的注释）。
export function renderMd(text) {
  try { return marked.parse(neutralizeHtml(text), { async: false }); }
  catch { return (text || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
}
export function highlightHtml(root) {
  if (!root) return;
  root.querySelectorAll('pre code:not(.hljs)').forEach(el => { try { hljs.highlightElement(el); } catch {} });
}
