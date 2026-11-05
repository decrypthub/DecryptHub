import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { markdownTokens, renderMarkdownToken, highlightLine } from '../src/md.js';
const render = source => { const tokens = markdownTokens(source); return tokens.map(token => renderMarkdownToken(token, tokens.links)).join(''); };

test('block rendering retains the configured link policy instead of the parser default', () => {
  const dom = new JSDOM(render('[safe](https://example.test/path) [unsafe](javascript:alert(1)) [data](data:text/html,attack)'));
  assert.equal(dom.window.document.querySelectorAll('a').length, 1);
  assert.equal(dom.window.document.querySelector('a').href, 'https://example.test/path');
  dom.window.close();
});
test('untrusted HTML stays text in ordinary blocks and highlighted code', () => {
  const raw = '<img src=x onerror=alert(1)><script>attack()</script>';
  const dom = new JSDOM(render(raw + '\n\n```html\n' + raw + '\n```'));
  assert.equal(dom.window.document.querySelector('img,script'), null);
  assert.ok(dom.window.document.body.textContent.includes('<img'));
  const highlighted = new JSDOM('<code>' + highlightLine(raw, 'html') + '</code>');
  assert.equal(highlighted.window.document.querySelector('img,script'), null);
  assert.equal(highlighted.window.document.querySelector('code').textContent, raw);
  dom.window.close(); highlighted.window.close();
});
test('a settled reference link resolves with the full document definitions', () => {
  const dom = new JSDOM(render('Read [the source][ref].\n\nOther text.\n\n[ref]: https://example.test/source'));
  assert.equal(dom.window.document.querySelector('a').href, 'https://example.test/source');
  dom.window.close();
});
