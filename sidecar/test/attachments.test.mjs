import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { Agent } from '../agent.mjs';
import { registerAttachment, validateAttachments, attachment, attachmentPreview, imageContent, inspectImage } from '../attachments.mjs';
import { messageTokens } from '../context.mjs';
import { toAnthropicMessages } from '../providers/anthropic.mjs';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j+1cAAAAASUVORK5CYII=', 'base64');
const fixture = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-attachments-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
test('attachments sniff image type, preserve bytes and reject tampering', t => {
  const dir = fixture(t), a = registerAttachment(dir, { name: '../../photo.jpg', mime: 'image/jpeg', data: PNG });
  assert.equal(a.name, 'photo.jpg'); assert.equal(a.mime, 'image/png'); assert.equal(a.width, 1);
  assert.deepEqual(Buffer.from(attachmentPreview(dir, a.id).dataUrl.split(',')[1], 'base64'), PNG);
  assert.throws(() => attachment(fixture(t), a.id), /ENOENT/);
  const file = attachment(dir, a.id).file, changed = Buffer.from(PNG); changed[changed.length - 1] ^= 1; fs.writeFileSync(file, changed);
  assert.throws(() => attachment(dir, a.id), /已变化/);
});
test('attachment boundaries reject invalid encoding, oversized dimensions and unsafe formats', t => {
  const dir = fixture(t);
  assert.throws(() => attachment(dir, '../outside'), /无效/);
  assert.throws(() => registerAttachment(dir, { name: 'x.png', data: 'invalid base64' }), /编码/);
  assert.throws(() => registerAttachment(dir, { name: 'x.svg', mime: 'image/svg+xml', data: Buffer.from('<svg/>') }), /格式/);
  const huge = Buffer.from(PNG); huge.writeUInt32BE(50000, 16); assert.throws(() => inspectImage(huge), /尺寸/);
  assert.throws(() => registerAttachment(dir, { name: 'x.txt', data: Buffer.alloc(8 * 1024 * 1024 + 1) }), /8MB/);
});
test('images require a capable model and token estimates never count base64 as text', t => {
  const dir = fixture(t), a = registerAttachment(dir, { name: 'photo.png', data: PNG }), input = [{ kind: 'attachment', id: a.id }];
  assert.throws(() => validateAttachments(dir, input), /未启用图片/);
  assert.equal(validateAttachments(dir, input, { vision: true })[0].image, true);
  assert.throws(() => validateAttachments(dir, Array(9).fill(input[0]), { vision: true }), /8 个/);
  const content = [{ type: 'text', text: 'hello' }, ...imageContent(dir, [a.id], true)];
  assert.ok(messageTokens({ role: 'user', content }) > 2000); assert.ok(messageTokens({ role: 'user', content }) < 2100);
  const converted = toAnthropicMessages([{ role: 'user', content }]).messages[0].content;
  assert.equal(converted[1].type, 'image'); assert.equal(converted[1].source.media_type, 'image/png'); assert.equal(converted[1].source.data, PNG.toString('base64'));
});
for (const provider of ['openai', 'anthropic']) test(`${provider}: actual HTTP request includes image bytes and history restores image references`, async t => {
  const dir = fixture(t); let received;
  const server = http.createServer((req, res) => { let text = ''; req.on('data', b => text += b); req.on('end', () => {
    received = JSON.parse(text); res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (provider === 'openai') res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: '已收到图片' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
    else res.end('data: ' + JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: '已收到图片' } }) + '\n\ndata: ' + JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }) + '\n\n');
  }); });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => { server.closeAllConnections(); return new Promise(r => server.close(r)); });
  const settings = { provider, [provider]: { baseUrl: `http://127.0.0.1:${server.address().port}` + (provider === 'openai' ? '/v1' : ''), model: 'fixture-vision', apiKey: 'fixture', vision: true } };
  const create = () => new Agent({ projectDir: dir, getSettings: () => settings, tools: [], mcp: { tools: [] }, emit() {} });
  const a = registerAttachment(dir, { name: 'clipboard.png', data: PNG }), agent = create();
  const result = await agent.send('', { attachments: [{ kind: 'attachment', id: a.id }], runId: 'test-turn' }); assert.equal(result.stop, 'completed');
  const parts = received.messages.find(m => m.role === 'user').content;
  assert.equal(parts[1].type, provider === 'openai' ? 'image_url' : 'image');
  assert.ok(JSON.stringify(parts[1]).includes(PNG.toString('base64')));
  const disk = fs.readFileSync(path.join(dir, '.agent-history.json'), 'utf8'); assert.ok(!disk.includes(PNG.toString('base64')));
  const restored = create(); restored.restore(); assert.equal(restored.hist.events[0].attachments[0].id, a.id);
  assert.ok(JSON.stringify(restored.wire()).includes(PNG.toString('base64')));
  assert.equal(restored.hist.events[1].phase, 'final_answer');
});
