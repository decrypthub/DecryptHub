// Markdown 里的原始 HTML 中和：把「模型/网页内容带进来的 HTML」降级成纯文本。
//
// 为什么需要：渲染链路是 marked → dangerouslySetInnerHTML，而 markdown 的输入里混着
// 抓包响应体、脚本片段和模型回复——只要有一条 <img src=x onerror=...> 混进来，
// 就会在渲染进程里执行，而渲染进程手里有 window.api（完整 sidecar RPC）和 Tauri 的
// secret_get（API Key）。
//
// 做法：转义代码块与行内代码**之外**的 '<'。这样
//   - `a < b` 显示成 a < b（HTML 实体在渲染后仍是 <，视觉无损）
//   - <img onerror> 变成字面文本，不再解析成标签
//   - ``` 代码块、`行内代码` 原样保留
// 唯一可见的损失是 autolink（<https://x>）不再自动变链接——这是刻意接受的代价。
// 注意：只认围栏代码块（``` / ~~~），不认 4 空格缩进式代码块。缩进块里的 '<' 会被转成实体，
// 显示时多出 &lt; —— 宁可这里难看一点，也不要因为「判断缩进块」猜错而漏掉一个标签。
//
// 纯函数、零依赖，可被 node:test 直接 import（见 sidecar/test/ui-sanitize.test.mjs）。

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

/** 把行内代码 span（`...`）之外的 '<' 转义 */
function escapeOutsideCodeSpans(line) {
  if (!line.includes('<')) return line;
  let out = '';
  let inCode = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '`') { inCode = !inCode; out += ch; continue; }
    out += (!inCode && ch === '<') ? '&lt;' : ch;
  }
  return out;
}

/**
 * @param {string} markdown
 * @returns {string} 中和原始 HTML 之后的 markdown
 */
export function neutralizeHtml(markdown) {
  const src = String(markdown ?? '');
  if (!src.includes('<')) return src;
  const lines = src.split('\n');
  const out = new Array(lines.length);
  let fence = null; // 当前所在的围栏字符：'`' 或 '~'
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = FENCE.exec(line);
    if (m) {
      const mark = m[1][0];
      if (!fence) fence = mark;
      else if (fence === mark && m[1].length >= 3) fence = null;
      out[i] = line; // 围栏行本身原样保留
      continue;
    }
    out[i] = fence ? line : escapeOutsideCodeSpans(line);
  }
  return out.join('\n');
}
