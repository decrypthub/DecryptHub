// 前端 markdown 中和的回归测试。
// 放在 sidecar/test 下是为了被 CI 的 `node --test test/` 一并跑到：
// ui/src/sanitize.js 是零依赖纯函数，node 可以直接 import。
import test from 'node:test';
import assert from 'node:assert/strict';
import { neutralizeHtml } from '../../ui/src/sanitize.js';

test('转义原始 HTML 标签（事件处理器不再被解析）', () => {
  const out = neutralizeHtml('看图 <img src=x onerror="fetch(1)"> 完');
  assert.equal(out.includes('<img'), false);
  assert.match(out, /&lt;img src=x onerror="fetch\(1\)">/);
});

test('script/iframe/svg 等标签同样失效', () => {
  for (const payload of ['<script>alert(1)</script>', '<iframe src="x"></iframe>', '<svg onload=alert(1)>', '<a href="javascript:alert(1)">x</a>']) {
    const out = neutralizeHtml(payload);
    assert.equal(/<(script|iframe|svg|a)\b/i.test(out), false, payload);
    assert.match(out, /&lt;/, payload);
  }
});

test('围栏代码块内原样保留（示例代码能正常显示）', () => {
  const md = ['说明', '```html', '<img onerror="x">', '<div class="a">', '```', '结束 <b>'].join('\n');
  const out = neutralizeHtml(md);
  assert.match(out, /```html\n<img onerror="x">\n<div class="a">\n```/);
  assert.match(out, /结束 &lt;b>/);
});

test('波浪号围栏与嵌套围栏', () => {
  const md = ['~~~js', 'if (a < b) {}', '~~~', '普通 <i>'].join('\n');
  const out = neutralizeHtml(md);
  assert.match(out, /if \(a < b\) \{\}/);
  assert.match(out, /普通 &lt;i>/);
});

test('行内代码里的 < 不算标签，也不被转义', () => {
  const out = neutralizeHtml('用 `<div>` 和 `a < b` 表示');
  assert.match(out, /`<div>`/);
  assert.match(out, /`a < b`/);
});

test('普通文本里的 < 转成实体（渲染后视觉不变）', () => {
  assert.equal(neutralizeHtml('a < b'), 'a &lt; b');
  assert.equal(neutralizeHtml('x < y > z'), 'x &lt; y > z');
});

test('不含 < 的文本零改动（快路径）', () => {
  const md = '# 标题\n\n- 列表\n\n```js\nconst a = 1;\n```\n';
  assert.equal(neutralizeHtml(md), md);
  assert.equal(neutralizeHtml(null), '');
  assert.equal(neutralizeHtml(undefined), '');
});

test('未闭合围栏：后续内容都不动（宁可少转义也不破坏代码显示）', () => {
  const md = ['```', '<img onerror="x">', '还在代码块里'].join('\n');
  assert.match(neutralizeHtml(md), /<img onerror="x">/);
});
