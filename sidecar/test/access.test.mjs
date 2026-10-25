// 接入控制：Origin 白名单、token 提取、定长比较、握手判定。
import test from 'node:test';
import assert from 'node:assert/strict';
import { allowOrigin, tokenFromReq, safeEqual, denyReason } from '../access.mjs';

const req = ({ origin, url = '/', proto, header } = {}) => ({
  url,
  headers: {
    ...(origin !== undefined ? { origin } : {}),
    ...(proto ? { 'sec-websocket-protocol': proto } : {}),
    ...(header ? { 'x-jsra-token': header } : {}),
  },
});

test('allowOrigin: 只放行 Tauri 与回环来源', () => {
  for (const o of ['tauri://localhost', 'http://tauri.localhost', 'http://127.0.0.1:15248', 'http://localhost:5173', 'https://localhost']) {
    assert.equal(allowOrigin(o), true, o);
  }
  for (const o of ['https://evil.com', 'http://127.0.0.1.evil.com', 'null', 'file://x', 'http://tauri.localhost.evil.com']) {
    assert.equal(allowOrigin(o), false, o);
  }
  // 没有 Origin 的客户端（本机程序）不在这里判，交给 token
  assert.equal(allowOrigin(''), true);
  assert.equal(allowOrigin(undefined), true);
  // 显式白名单可以追加来源（例如自定义 dev 域名）
  assert.equal(allowOrigin('https://dev.local', { extra: ['https://dev.local'] }), true);
});

test('tokenFromReq: 查询参数 / 请求头 / 子协议三种通道', () => {
  assert.equal(tokenFromReq(req({ url: '/?token=abc' })), 'abc');
  assert.equal(tokenFromReq(req({ url: '/?token=abc&x=1' })), 'abc');
  assert.equal(tokenFromReq(req({ url: '/', header: 'hdr' })), 'hdr');
  assert.equal(tokenFromReq(req({ url: '/', proto: 'jsra.tok' })), 'tok');
  assert.equal(tokenFromReq(req({ url: '/', proto: 'foo, jsra.tok2, bar' })), 'tok2');
  assert.equal(tokenFromReq(req({ url: '/' })), '');
  assert.equal(tokenFromReq(null), '');
  assert.equal(tokenFromReq({ url: '/?token=%E4%BD%A0' }), '你');
});

test('safeEqual: 长度不同/空值一律不等，相同则相等', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'ab'), false);
  assert.equal(safeEqual('', ''), false);
  assert.equal(safeEqual(undefined, 'x'), false);
  assert.equal(safeEqual(null, null), false);
});

test('denyReason: 缺 token 拒绝、错 token 拒绝、对的放行', () => {
  const token = 'k'.repeat(48);
  assert.equal(denyReason(req({ origin: 'tauri://localhost', url: `/?token=${token}` }), token), null);
  assert.equal(denyReason(req({ url: `/?token=${token}` }), token), null, '无 Origin 但 token 对也放行');
  assert.equal(denyReason(req({ origin: 'tauri://localhost', url: '/?token=wrong' }), token), 'token');
  assert.equal(denyReason(req({ origin: 'tauri://localhost' }), token), 'token');
  assert.equal(denyReason(req({ origin: 'https://evil.com', url: `/?token=${token}` }), token), 'origin');
  assert.equal(denyReason(req({ origin: 'null', url: `/?token=${token}` }), token), 'origin');
});

test('denyReason: 未配置 token 时退回只查 Origin（兼容旧调试方式）', () => {
  assert.equal(denyReason(req({ origin: 'tauri://localhost' }), ''), null);
  assert.equal(denyReason(req({ origin: 'https://evil.com' }), ''), 'origin');
});
