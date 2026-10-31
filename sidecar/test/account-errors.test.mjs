import test from 'node:test';
import assert from 'node:assert/strict';
import { accountErrorMessage } from '../../ui/src/account-errors.js';
import fs from 'node:fs';

test('account UI preserves native Tauri string failures and JS error messages', () => {
  assert.equal(accountErrorMessage('无法打开系统浏览器'), '无法打开系统浏览器');
  assert.equal(accountErrorMessage(new Error('账号凭据保存失败')), '账号凭据保存失败');
  for (const error of [null, undefined, {}, '', new Error('')]) assert.equal(accountErrorMessage(error), '账号操作未完成，请重试');
});

test('every account bridge command is registered and permitted by the native main-window capability', () => {
  const read = relative => fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
  const bridge = read('../../ui/src/transport.js');
  const handler = read('../../src-tauri/src/main.rs');
  const permission = read('../../src-tauri/permissions/app.toml');
  const capability = JSON.parse(read('../../src-tauri/capabilities/default.json'));
  const commands = [...bridge.matchAll(/tauriInvoke\('(account_[a-z_]+)'/g)].map(match => match[1]);
  assert.ok(commands.length >= 7);
  for (const command of commands) {
    assert.ok(handler.includes('account::' + command), `Native handler missing: ${command}`);
    assert.ok(permission.includes('"' + command + '"'), `Native permission missing: ${command}`);
  }
  assert.ok(capability.permissions.includes('allow-app-commands'));
  assert.deepEqual(capability.windows, ['main']);
  assert.equal(capability.local, true);
  assert.ok(!permission.includes('"secret_get"'), 'Plaintext credential reads must remain unavailable');
});
