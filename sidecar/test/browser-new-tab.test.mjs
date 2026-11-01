import test from 'node:test';
import assert from 'node:assert/strict';
import { BROWSER_TOOLS } from '../browsertools.mjs';
import { decideTool } from '../policy.mjs';

test('browser_new_tab creates a page without touching the current one', async () => {
  const tool = BROWSER_TOOLS.find(item => item.name === 'browser_new_tab');
  assert.ok(tool, 'browser_new_tab must be registered');
  const opened = [];
  const result = await tool.run({ url: 'example.com' }, {
    browser: {
      newPage: async url => { opened.push(url); },
      activePage: { url: () => 'https://example.com/' },
    },
  });
  assert.deepEqual(opened, ['https://example.com']);
  assert.match(result.text, /新标签页已打开/);
});

test('browser_new_tab is a read-only-safe action', () => {
  assert.equal(decideTool('read-only', 'browser_new_tab', { url: 'https://example.com' }).action, 'run');
  assert.equal(decideTool('standard', 'browser_new_tab', { url: 'https://example.com' }).action, 'run');
});

test('browser_upload selects a workspace file and rejects paths outside it', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-upload-'));
  fs.writeFileSync(path.join(dir, 'shot.png'), 'image-bytes');
  const tool = BROWSER_TOOLS.find(item => item.name === 'browser_upload');
  assert.ok(tool, 'browser_upload must be registered');
  let selected = '';
  const page = { isClosed: () => false, locator: () => ({ setInputFiles: async file => { selected = file; } }) };
  const ctx = { workRoot: dir, mode: 'standard', browser: { activePage: page } };
  const result = await tool.run({ selector: 'input[type=file]', path: 'shot.png' }, ctx);
  assert.match(result.text, /已把文件选择到表单/);
  assert.equal(selected, path.join(dir, 'shot.png'));
  await assert.rejects(() => tool.run({ selector: 'input[type=file]', path: '../secret.txt' }, ctx), /越界|outside|范围/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('browser_upload requires approval in standard mode and is denied in read-only', () => {
  assert.equal(decideTool('read-only', 'browser_upload', { selector: 'input', path: 'a.png' }).action, 'deny');
  const standard = decideTool('standard', 'browser_upload', { selector: 'input', path: 'a.png' });
  assert.equal(standard.action, 'approve');
  assert.equal(standard.category, 'external');
});
