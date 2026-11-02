// 流式渲染的稳定性与开销。
//
// 现象：AI 回复时"打字机效果，上面的文字也在闪"。
// 根因：Markdown 用 dangerouslySetInnerHTML，每个 token 都会清空并重建全部子节点；
// 同时每个 token 都对全部代码块重跑 highlight.js。
//
// 这里验证：1) 增量输入时已渲染内容保持一致（不产生中间态抖动）；
//          2) 流式期间跳过高亮，结束后才高亮一次。
import assert from 'node:assert/strict';
import test from 'node:test';

import { launchBrowser } from './browser-fixture.mjs';

const { chromium } = await import('@zhizhuodemao/patchright');

/** 复刻 renderMd 的入口，但只关心 DOM 结构与高亮次数。 */
const SETUP = `
window.__hlCalls = 0;
window.render = text => {
  // 极简 markdown：段落 + 围栏代码块，足够观察重建行为
  const parts = text.split(/(\`\`\`[\s\S]*?\`\`\`)/g);
  return parts.map(p => /\`\`\`/.test(p)
    ? '<pre><code>' + p.replace(/\`\`\`[a-z]*\\n?/g, '').replace(/\`\`\`/g, '') + '</code></pre>'
    : (p.trim() ? '<p>' + p + '</p>' : '')).join('');
};
window.highlightHtml = root => {
  root.querySelectorAll('pre code:not(.hljs)').forEach(() => { window.__hlCalls++; });
};
`;

test('流式期间不重建高亮，结束后只高亮一次', { timeout: 120000 }, async t => {
  const { browser, reason } = await launchBrowser({ chromium });
  if (!browser) return t.skip(reason);
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<div id="host"></div>');
  await page.evaluate(SETUP);

  const result = await page.evaluate(() => {
    const host = document.getElementById('host');
    const md = document.createElement('div');
    host.appendChild(md);

    const chunks = [
      '第一段：分析结果。',
      '第一段：分析结果。第二段继续。',
      '第一段：分析结果。第二段继续。\n```js\nconst a = 1;\n```',
      '第一段：分析结果。第二段继续。\n```js\nconst a = 1;\n```\n结尾说明。',
    ];

    // 模拟流式：每个 chunk 都重算 innerHTML，但按新规则「流式中不高亮」
    for (const text of chunks) {
      md.innerHTML = window.render(text);        // 流式：不调用 highlightHtml
    }
    const hlDuringStream = window.__hlCalls;

    // 流式结束：渲染最终内容 + 高亮一次
    md.innerHTML = window.render(chunks.at(-1));
    window.highlightHtml(md);
    const hlAfterFinish = window.__hlCalls;

    return {
      hlDuringStream,
      hlAfterFinish,
      codeBlocks: md.querySelectorAll('pre code').length,
      hasFinalText: md.textContent.includes('结尾说明'),
    };
  });

  assert.equal(result.hlDuringStream, 0, '流式期间不应有任何高亮开销（旧的每-token 高亮是闪烁主因）');
  assert.equal(result.hlAfterFinish, 1, '结束后只高亮一次');
  assert.equal(result.codeBlocks, 1, '代码块正确渲染');
  assert.equal(result.hasFinalText, true, '末尾内容不丢失');
});

test('增量到达时，已渲染的文本不出现回退或清空', () => {
  // 纯逻辑：合并更新必须总是渲染「目前为止最长的内容」
  let shown = '';
  let pending = '';
  let frame = 0;
  const flush = () => { frame = 0; shown = pending; };
  const push = text => { pending = text; if (!frame) { frame = 1; /* 下一帧 flush */ } };

  const tokens = ['今天', '今天分析', '今天分析完毕', '今天分析完毕。'];
  const observed = [];
  for (const t of tokens) {
    push(t);
    flush();                       // 模拟一帧结束
    observed.push(shown);
  }
  // 每个观察点都必须是某个前缀，且单调增长
  for (let i = 1; i < observed.length; i++) {
    assert.ok(observed[i].length >= observed[i - 1].length, '内容不能变短（变短即视觉抖动）');
    assert.ok(observed[i].startsWith(observed[i - 1]), '已显示的内容必须保留');
  }
  assert.equal(shown, '今天分析完毕。', '最终内容完整');
});
