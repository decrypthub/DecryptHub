import test from 'node:test';
import assert from 'node:assert/strict';
import { FEEDBACK_URL, openFeedback } from '../feedback.mjs';

test('feedback only opens the fixed public issue form from a native host', async () => {
  assert.equal(FEEDBACK_URL, 'https://github.com/decrypthub/DecryptHub/issues/new/choose');
  for (const [platform, expected] of [['darwin', 'open'], ['win32', 'explorer.exe'], ['linux', 'xdg-open']]) {
    const calls = [];
    assert.deepEqual(await openFeedback({ nativeHost: true, platform, launch: async (...args) => calls.push(args) }), { opened: true });
    assert.equal(calls[0][0], expected);
    assert.deepEqual(calls[0][1], [FEEDBACK_URL]);
    assert.equal(calls[0][2].shell, undefined);
    assert.equal(calls[0][2].timeout, 5000);
    assert.equal(calls[0][2].env.JSRA_OPENAI_KEY, undefined);
  }
  await assert.rejects(openFeedback({ launch: () => assert.fail('must not launch') }), /桌面应用/);
  await assert.rejects(openFeedback({ nativeHost: true, platform: 'unknown', launch: () => assert.fail('must not launch') }), /不支持/);
});

test('launcher errors do not expose stderr or environment details', async () => {
  await assert.rejects(openFeedback({ nativeHost: true, platform: 'darwin', launch: async () => { throw Error('private stderr'); } }), { message: '无法打开系统浏览器' });
});
