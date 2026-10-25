// 「机器生成的值」识别：只看值的形态，绝不看参数名。
// 这组用例同时是「通用性」的守门员：如果谁再把某个站点的参数名写进判断逻辑，这里的
// 「命名无关」用例会挂。
import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreValue, detectSig, entropy, parseBody } from '../sig.mjs';

test('定长十六进制摘要 → strong（与参数名无关）', () => {
  for (const v of ['d41d8cd98f00b204e9800998ecf8427e', '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08', '0123456789abcdef0123456789abcdef01234567']) {
    assert.equal(scoreValue(v), 'strong', v.slice(0, 12));
  }
  // 常量重复串（熵为 0）不是摘要，不该被当成签名
  assert.equal(scoreValue('a'.repeat(40)), null);
});

test('高熵 base64/自定义字母表 → strong；短一些的 → weak', () => {
  assert.equal(scoreValue('Zm9vYmFyMTIzNDU2Nzg5MGFiY2RlZg=='), 'strong');
  assert.equal(scoreValue('Ab3dE9xK2mQ7'), 'weak');
});

test('明显的「不是」：数字/时间戳/日期/UUID/URL/路径/邮箱/中文/JSON', () => {
  for (const v of ['1234567890', '1700000000', '2026-10-22T09:00:00Z', 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    'https://example.com/a', '/api/v1/list', 'user@example.com', '这是一段中文说明', '{"a":1}', 'hello world']) {
    assert.equal(scoreValue(v), null, v);
  }
});

test('命名无关：随便叫什么都一样判断（这是通用工具的底线）', () => {
  const md5 = 'd41d8cd98f00b204e9800998ecf8427e';
  const r1 = detectSig({ url: `https://x.test/a?whatever=${md5}`, headers: {} });
  const r2 = detectSig({ url: `https://x.test/a?sign=${md5}`, headers: {} });
  assert.equal(r1.length, 1);
  assert.equal(r2.length, 1);
  assert.equal(r1[0].level, r2[0].level, '参数名不该影响等级');
  // 反过来：名字叫 sign 但值是人能读的短词 → 不算
  assert.equal(detectSig({ url: 'https://x.test/a?sign=abc', headers: {} }).length, 0);
});

test('扫 query / header / body 三处', () => {
  const hex = 'd41d8cd98f00b204e9800998ecf8427e';
  const r = detectSig({
    url: `https://x.test/a?q=${hex}`,
    headers: { 'content-type': 'application/json', 'x-any': hex },
    postData: JSON.stringify({ payload: hex, plain: 'ok' }),
  });
  const fields = r.map(x => `${x.where}.${x.name}`);
  assert.deepEqual(fields.sort(), ['body.payload', 'header.x-any', 'query.q']);
  assert.equal(parseBody('{"payload":"x"}', 'application/json').kind, 'json');
});

test('entropy: 自然语言低于随机串', () => {
  assert.ok(entropy('aaaaaaaaaaaaaaaa') < 1);
  assert.ok(entropy('9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08') > 3);
});
