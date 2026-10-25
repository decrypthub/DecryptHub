import test from 'node:test';
import assert from 'node:assert/strict';
import { McpHost, normalizeServer, serverFingerprint, approvedServers, qualifiedToolName } from '../mcphost.mjs';
const config = name => { const c = normalizeServer(name, { command: 'example' }); c.approvedFingerprint = serverFingerprint(c); return c; };
const connection = (listTools = async () => ({ tools: [{ name: 'read', inputSchema: { type: 'object' } }] })) => ({ client: { listTools, close: async () => {} }, transport: {} });
test('saving one MCP config does not trust another or accept forged fingerprints', () => {
  const a = config('a'), b = config('b');
  const next = approvedServers({ a, b }, {}, ['a']);
  assert.equal(next.a.approvedFingerprint, serverFingerprint(a)); assert.equal(next.b.approvedFingerprint, '');
  assert.equal(approvedServers({ a }, { a }).a.approvedFingerprint, a.approvedFingerprint);
  assert.equal(approvedServers({ a: { ...a, args: ['changed'] } }, { a }).a.approvedFingerprint, '');
});
test('unapproved MCP startup can be approved later without a stuck start lock', async () => {
  let cfg = { ...config('a'), approvedFingerprint: '' }, calls = 0;
  const h = new McpHost({ getServers: () => ({ a: cfg }) }); h.connect = async () => { calls++; return connection(); };
  await h.apply(); assert.equal(h.status()[0].state, 'needs-approval'); assert.equal(h.starting.size, 0);
  cfg = config('a'); await h.apply(); await Promise.all([...h.starting.values()]);
  assert.equal(calls, 1); assert.equal(h.status()[0].state, 'ready'); await h.close();
});
test('a stale connection cannot register tools after disable', async () => {
  let cfg = config('a'), resolveConnect, closed = 0;
  const h = new McpHost({ getServers: () => ({ a: cfg }) });
  h.connect = () => new Promise(r => { resolveConnect = r; });
  await h.apply(); await Promise.resolve(); const pending = h.starting.get('a');
  cfg = { ...cfg, enabled: false }; await h.apply();
  const c = connection(); c.client.close = async () => { closed++; }; resolveConnect(c); await pending;
  assert.equal(h.status()[0].state, 'disabled'); assert.equal(h.tools().length, 0); assert.equal(closed, 1);
});
test('failed tool listing closes the connected MCP process', async () => {
  const cfg = config('a'), h = new McpHost({ getServers: () => ({ a: cfg }) }); let closed = 0;
  const c = connection(async () => { throw new Error('bad list'); }); c.client.close = async () => { closed++; }; h.connect = async () => c;
  await h.apply(); await Promise.all([...h.starting.values()]); assert.equal(closed, 1); assert.equal(h.status()[0].state, 'error');
});
test('qualified MCP names preserve identity when sanitizing or truncating', () => {
  assert.notEqual(qualifiedToolName('a.b', 'x'), qualifiedToolName('a_b', 'x'));
  assert.notEqual(qualifiedToolName('a', 'x'.repeat(100) + '1'), qualifiedToolName('a', 'x'.repeat(100) + '2'));
  assert.match(qualifiedToolName('a.b', 'x'.repeat(100)), /^[A-Za-z0-9_-]{1,64}$/);
});
