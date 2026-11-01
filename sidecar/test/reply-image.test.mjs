// AI 向用户发图：reply_image 工具、截图回传、正文插图位置、以及「历史不落 base64」不变量。
//
// 这套测试守的核心是：图片只能以附件 id 在事件/历史里流动。一旦哪天有人图省事
// 把 base64 塞进 tool 结果或 Markdown，这里会立刻红。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Agent } from '../agent.mjs';
import { registerAttachment, attachment } from '../attachments.mjs';
import { normalizeReplyImages, registerReplyImage } from '../reply-image.mjs';
import { DEFAULT_TOOLS } from '../catalog.mjs';
import { toolRisk, decideTool } from '../policy.mjs';
import { splitImageRefs } from '../../ui/src/image-refs.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j+1cAAAAASUVORK5CYII=', 'base64');
const fixture = t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-reply-image-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'workspace'), { recursive: true });
  return dir;
};

test('reply_image is registered and classified read-only so policy stays complete', () => {
  const tool = DEFAULT_TOOLS.find(t => t.name === 'reply_image');
  assert.ok(tool, 'reply_image 必须出现在默认工具注册表里');
  assert.equal(toolRisk('reply_image'), 'read');
  // 只读模式下也要能用：把已有图片展示给用户不产生任何外部副作用。
  assert.equal(decideTool('read-only', 'reply_image').action, 'run');
});

test('reply_image accepts a workspace image and rejects everything else', t => {
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, 'workspace', 'shot.png'), PNG);
  fs.writeFileSync(path.join(dir, 'workspace', 'fake.png'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  fs.writeFileSync(path.join(dir, 'workspace', 'notes.txt'), 'hello');
  const ctx = { workRoot: path.join(dir, 'workspace'), workspaceKind: 'folder' };

  const ok = registerReplyImage(dir, { path: 'shot.png' }, { ctx });
  assert.equal(ok.mime, 'image/png');
  assert.equal(ok.width, 1);
  assert.match(ok.id, /^[a-f0-9-]{36}$/);

  // 扩展名是 .png 但内容是 SVG：按文件头嗅探必须拒绝，不能靠扩展名放行。
  assert.throws(() => registerReplyImage(dir, { path: 'fake.png' }, { ctx }), /不是受支持的图片格式/);
  assert.throws(() => registerReplyImage(dir, { path: 'notes.txt' }, { ctx }), /不是受支持的图片格式/);
  // 远端地址一律拒绝（模型能触发 = 不能让屏幕内容由外部 URL 决定）。
  assert.throws(() => registerReplyImage(dir, { path: 'https://example.com/x.png' }, { ctx }), /不接受网址/);
  assert.throws(() => registerReplyImage(dir, { path: 'data:image/png;base64,AAAA' }, { ctx }), /不接受网址/);
  // 越界路径交给 workspacePath 拦。
  assert.throws(() => registerReplyImage(dir, { path: '../../etc/passwd' }, { ctx }), /工作区|超出|越界|无效/);
});

test('reply_image can reuse an existing attachment but re-verifies its hash', t => {
  const dir = fixture(t);
  const a = registerAttachment(dir, { name: 'clip.png', data: PNG });
  assert.equal(registerReplyImage(dir, { attachmentId: a.id }).id, a.id);

  // 篡改附件后，reply_image 不能因为「id 眼熟」就放行。
  const file = attachment(dir, a.id).file;
  const changed = Buffer.from(PNG); changed[changed.length - 1] ^= 1;
  fs.writeFileSync(file, changed);
  assert.throws(() => registerReplyImage(dir, { attachmentId: a.id }), /已变化/);
});

test('images never enter tool text or history as base64', async t => {
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, 'workspace', 'shot.png'), PNG);
  const ctx = { workRoot: path.join(dir, 'workspace'), workspaceKind: 'folder' };
  const ref = registerReplyImage(dir, { path: 'shot.png' }, { ctx });

  // 工具返回图片（截图 / reply_image 都走这条路）：只保留 id 与元信息。
  const normalized = normalizeReplyImages(dir, [{ ...ref, caption: '登录页' }]);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].id, ref.id);
  assert.equal(normalized[0].caption, '登录页');
  assert.ok(!JSON.stringify(normalized).includes(PNG.toString('base64')));

  // 工具当场拿到的 base64（截图 image block）在落地成附件后也只留 id。
  const fromBase64 = normalizeReplyImages(dir, [{ name: '截图.png', data: PNG.toString('base64') }]);
  assert.equal(fromBase64.length, 1);
  assert.ok(!JSON.stringify(fromBase64).includes(PNG.toString('base64')));

  // 坏图不该让同批其他图片或整次调用失败。
  assert.equal(normalizeReplyImages(dir, [{ name: 'bad.png', data: 'not base64' }]).length, 0);
  assert.equal(normalizeReplyImages(dir, [null, undefined, 42]).length, 0);
});

test('tool events and saved history carry image ids only, and survive a reload', async t => {
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, 'workspace', 'shot.png'), PNG);
  const ctx = { workRoot: path.join(dir, 'workspace'), workspaceKind: 'folder' };
  let received;
  const server = http.createServer((req, res) => { let body = ''; req.on('data', b => body += b); req.on('end', () => {
    received = JSON.parse(body);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    // 第一步：模型调 reply_image；第二步：给出最终回复（正文用 image:<id> 指定位置）。
    const first = !received.messages.some(m => m.role === 'tool');
    const chunk = first
      ? { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'reply_image', arguments: JSON.stringify({ path: 'shot.png', caption: '登录页' }) } }] } }] }
      : { choices: [{ delta: { content: '截图如下：\n\n![登录页](image:PLACEHOLDER)\n\n按钮在右下角。' }, finish_reason: 'stop' }] };
    res.end('data: ' + JSON.stringify(chunk) + '\n\ndata: [DONE]\n\n');
  }); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); return new Promise(r => server.close(r)); });

  const settings = { provider: 'openai', openai: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'fixture', apiKey: 'k', vision: true } };
  const emitted = [];
  const create = () => new Agent({
    projectDir: dir, getSettings: () => settings, tools: DEFAULT_TOOLS, mcp: { tools: [] },
    emit: (ev, p) => emitted.push({ ev, p }), getWorkspace: () => ({ id: 'w1', root: ctx.workRoot, kind: 'folder' }),
    getToolContext: () => ({}),
  });
  const agent = create();
  const result = await agent.send('给我看下截图', { runId: 'turn-1' });
  assert.equal(result.stop, 'completed');

  const toolEnd = emitted.find(e => e.ev === 'tool-end' && e.p.name === 'reply_image');
  assert.ok(toolEnd, 'reply_image 必须产生 tool-end 事件');
  assert.equal(toolEnd.p.images.length, 1);
  assert.match(toolEnd.p.images[0].id, /^[a-f0-9-]{36}$/);
  // 事件里绝对不能出现 base64，否则会随 IPC 一路灌进 UI 状态。
  assert.ok(!JSON.stringify(toolEnd.p).includes(PNG.toString('base64')));

  // 历史文件同样只留 id。
  const disk = fs.readFileSync(path.join(dir, '.agent-history.json'), 'utf8');
  assert.ok(!disk.includes(PNG.toString('base64')), '历史里不能出现 base64');
  const savedTool = JSON.parse(disk).events.find(e => e.t === 'tool' && e.name === 'reply_image');
  assert.equal(savedTool.images.length, 1);

  // 重新加载后图片引用还在（UI 靠 id 去 .attachments 取图）。
  const restored = create(); restored.restore();
  const back = restored.hist.events.find(e => e.t === 'tool' && e.name === 'reply_image');
  assert.equal(back.images[0].id, savedTool.images[0].id);
});

test('take_screenshot image blocks reach the reply instead of being dropped', async t => {
  const dir = fixture(t);
  // 直接验证 Agent 对「工具返回 base64 图片」的处理：browser.invoke 会把 image block
  // 归一成 { name, data }，这里用同形状的假工具代替真实内核。
  const tools = [{ name: 'take_screenshot', description: '截图', schema: { type: 'object', properties: {} }, run: async () => ({ text: 'Took a screenshot of the current page viewport.', images: [{ name: '截图.png', data: PNG.toString('base64') }] }) }];
  let calls = 0, received;
  const server = http.createServer((req, res) => { let body = ''; req.on('data', b => body += b); req.on('end', () => {
    received = JSON.parse(body);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const step = calls++;
    const chunk = step === 0
      ? { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'take_screenshot', arguments: '{}' } }] } }] }
      : { choices: [{ delta: { content: '已截图。' }, finish_reason: 'stop' }] };
    res.end('data: ' + JSON.stringify(chunk) + '\n\ndata: [DONE]\n\n');
  }); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); return new Promise(r => server.close(r)); });
  const settings = { provider: 'openai', openai: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'fixture', apiKey: 'k', vision: true } };
  const emitted = [];
  const agent = new Agent({ projectDir: dir, getSettings: () => settings, tools, mcp: { tools: [] }, emit: (ev, p) => emitted.push({ ev, p }), getToolContext: () => ({}) });
  await agent.send('截个图', { runId: 't2' });

  const end = emitted.find(e => e.ev === 'tool-end' && e.p.name === 'take_screenshot');
  assert.ok(end, '截图工具必须产生 tool-end');
  assert.equal(end.p.images?.length, 1, '截图不能再被丢弃');
  assert.match(end.p.images[0].id, /^[a-f0-9-]{36}$/);
  // 图片只对用户展示，不作为 tool 结果回喂模型（tool role 普遍不接受图片块）。
  const toolMsg = received.messages.find(m => m.role === 'tool');
  assert.ok(toolMsg, '必须有 tool 结果');
  assert.equal(typeof toolMsg.content, 'string');
  assert.ok(!toolMsg.content.includes(PNG.toString('base64')));
});

test('splitImageRefs locates inline images and leaves other markdown alone', () => {
  const id = '11111111-2222-3333-4444-555555555555';
  const parts = splitImageRefs(`前文\n\n![登录页](image:${id})\n\n后文`);
  assert.deepEqual(parts.map(p => p.type), ['text', 'image', 'text']);
  assert.equal(parts[1].id, id);
  assert.equal(parts[1].label, '登录页');

  // 普通 Markdown 图片、非法的 image: 目标、以及没有图片的正文都不受影响。
  assert.deepEqual(splitImageRefs('![](https://example.com/a.png)'), [{ type: 'text', text: '![](https://example.com/a.png)' }]);
  assert.deepEqual(splitImageRefs('![x](image:not-a-uuid)'), [{ type: 'text', text: '![x](image:not-a-uuid)' }]);
  assert.deepEqual(splitImageRefs('纯文本'), [{ type: 'text', text: '纯文本' }]);
  // 代码块里的同形文本目前仍会被匹配（模型解释这个语法时很常见）。
  // 这是已知取舍：切分在 Markdown 解析之前，认不出围栏；代价只是把一段示例文字
  // 显示成图片占位，且占位图仍需真实附件 id 才能出图，不会产生伪造内容。
  const inFence = '```md\n![x](image:' + id + ')\n```';
  assert.equal(splitImageRefs(inFence).filter(p => p.type === 'image').length, 1);
});
