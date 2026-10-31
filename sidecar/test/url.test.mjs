import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTargetUrl, resolveAddress } from '../url.mjs';

test('address bar turns a bare word into a domain guess', () => {
  assert.equal(resolveAddress('baidu'), 'https://baidu.com');
  assert.equal(resolveAddress('github'), 'https://github.com');
});

test('address bar keeps explicit urls and hosts untouched', () => {
  assert.equal(resolveAddress('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(resolveAddress('example.com/path'), 'example.com/path');
  assert.equal(resolveAddress('localhost:3000'), 'localhost:3000');
  assert.equal(resolveAddress('about:blank'), 'about:blank');
  assert.equal(resolveAddress(''), '');
});

test('address bar searches phrases instead of navigating to an invalid host', () => {
  assert.equal(resolveAddress('hello world'), 'https://www.baidu.com/s?wd=hello%20world');
  assert.match(resolveAddress('张三 教程'), /^https:\/\/www\.baidu\.com\/s\?wd=/);
});

test('normalization still rejects non-http schemes', () => {
  assert.throws(() => normalizeTargetUrl('javascript:alert(1)'), /HTTP/);
});

test('browser errors are translated into readable messages', async () => {
  const { describeBrowserError } = await import('../url.mjs');
  assert.match(describeBrowserError('page.goto: net::ERR_NAME_NOT_RESOLVED at https://baidu/'), /无法解析该域名/);
  assert.match(describeBrowserError('net::ERR_INTERNET_DISCONNECTED'), /网络连接不可用/);
  assert.equal(describeBrowserError('随便一个错误\n堆栈'), '随便一个错误');
});
