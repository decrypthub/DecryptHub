// 浏览器标签文案：只用可读标题；没有标题时退回域名，长 URL 不进标签。
import test from 'node:test';
import assert from 'node:assert/strict';
import { pageLabel, syncBrowserPages, emptyDock } from '../../ui/src/dock-tabs.js';

test('pageLabel prefers a readable page title', () => {
  assert.equal(pageLabel({ title: '知乎 - 有问题就会有答案', url: 'https://www.zhihu.com/question/1' }), '知乎 - 有问题就会有答案');
  assert.equal(pageLabel({ title: '  a\n b ', url: 'https://x.test/' }), 'a b');
});

test('pageLabel never falls back to the raw URL', () => {
  const long = 'https://example.com/' + 'a'.repeat(300);
  assert.equal(pageLabel({ title: '', url: long }), 'example.com');
  assert.equal(pageLabel({ title: long, url: long }), 'example.com');
  assert.equal(pageLabel({ title: 'https://example.com/x', url: 'https://example.com/x' }), 'example.com');
  assert.equal(pageLabel({ url: 'https://www.example.com/' }), 'example.com');
});

test('pageLabel handles blank pages and caps the label', () => {
  assert.equal(pageLabel({ url: 'about:blank' }), '新标签页');
  assert.equal(pageLabel({}), '新标签页');
  assert.equal(pageLabel({ title: '字'.repeat(120), url: 'https://x.test/' }).length, 60);
});

test('syncBrowserPages writes short readable titles instead of URLs', () => {
  const dock = emptyDock();
  const next = syncBrowserPages(dock, [{ id: 'p1', active: true, title: '', url: 'https://www.baidu.com/s?wd=' + 'x'.repeat(200) }]);
  assert.equal(next.tabs[0].title, 'baidu.com');
  assert.equal(next.tabs[0].pageId, 'p1');
});
