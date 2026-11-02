// 联网授权按域名记忆：扫几百个目标时不该因为域名列表变了就每一步重批。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { TestSessionManager as SessionManager } from './project-fixture.mjs';
import { executor } from '../executor.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wdh-net-'));
const manager = dir => new SessionManager({
  userDataDir: dir,
  getSettings: () => ({ openai: { apiKey: 'fixture', model: 'test', contextWindow: 1000000 } }),
  broadcast() {},
  chromeMod: {},
});

test('域名的授权按主机记忆，不随命令的域名集合变化而失效', async t => {
  const dir = tmp(), mgr = manager(dir); t.after(() => mgr.closeAll());
  const s = mgr.get('main');
  const asked = [];
  s.approve = async (req) => { asked.push(req); return true; };

  // 第一轮：只扫一个域名
  assert.equal(s.netGranted('a.example'), false);
  assert.equal(s.grantNet('a.example'), true);
  assert.equal(s.netGranted('a.example'), true);

  // 第二轮：域名集合扩大，已授权的仍然有效
  assert.equal(s.netGranted('a.example'), true, '已授权域名不因列表变化失效');
  assert.equal(s.netGranted('b.example'), false, '未授权域名仍要询问');
});

test('授权是精确匹配，不做子域或通配放行', async t => {
  const dir = tmp(), mgr = manager(dir); t.after(() => mgr.closeAll());
  const s = mgr.get('main');
  s.grantNet('target.example');
  assert.equal(s.netGranted('target.example'), true);
  assert.equal(s.netGranted('evil.target.example'), false, '子域不等于同一主机');
  assert.equal(s.netGranted('example'), false);
  assert.equal(s.netGranted('target.example:8443'), false, '不同端口是不同的目的地');
});

test('切换权限或工作区会清空域名授权', async t => {
  const dir = tmp(), mgr = manager(dir); t.after(() => mgr.closeAll());
  const s = mgr.get('main');
  s.grantNet('a.example');
  assert.equal(s.netGranted('a.example'), true);
  s.setMode('read-only');
  assert.equal(s.netGranted('a.example'), false, '降权必须收回所有联网授权');
});

test('审批卡片只列出还没授权的域名', async t => {
  const dir = tmp(), mgr = manager(dir); t.after(() => mgr.closeAll());
  const s = mgr.get('main');
  const asked = [];
  s.approve = async (req) => { asked.push(req); return true; };
  s.grantNet('a.example');
  const oldProbe = executor.probe;
  executor.probe = async () => ({ available: true, errors: [], warnings: [] });
  try {
    const file = path.join(dir, 'probe.mjs');
    fs.writeFileSync(file, 'console.log(1)');
    const job = await s.execute({ file: process.execPath, args: [file], cwd: s.workspace.root, network: ['a.example', 'b.example'], timeoutMs: 10000 });
    await job.done;
    assert.equal(asked.length, 1);
    assert.deepEqual(asked[0].network, ['b.example'], '已授权的 a.example 不该再出现在待批清单里');
    assert.equal(s.netGranted('b.example'), true, '获批后记为已授权');
  } finally { executor.probe = oldProbe; }
});
