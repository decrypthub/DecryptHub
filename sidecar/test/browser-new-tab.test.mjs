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

