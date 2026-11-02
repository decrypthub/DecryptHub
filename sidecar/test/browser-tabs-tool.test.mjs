// 审批记忆与驳回说明：长链路任务（逐字段回填表单、多步探测）不该每一步重批。
import test from 'node:test';
import assert from 'node:assert/strict';
import { decideTool, approvalCategory } from '../policy.mjs';
import { BrowserTabs } from '../browser-tabs.mjs';
import { BROWSER_TOOLS } from '../browsertools.mjs';

test('browser interaction is a repeatable external action, not a one-off', () => {
  for (const name of ['browser_click', 'browser_fill', 'browser_press', 'evaluate_script', 'page_call']) {
    assert.equal(decideTool('standard', name).action, 'approve', name);
    assert.equal(approvalCategory(name), 'external', name);
  }
});

test('new tab opens a page without leaving the current one', async () => {
  const calls = [];
  const page = (id, url) => ({ id, url: () => url, isClosed: () => false });
  const session = {
    closing: false,
    workspace: { id: 'ws', revision: 1, projectRevision: 1, root: 'C:/ws' },
    browser: {
      generation: 1,
      running: true,
      snapshot: { pages: [{ id: 'tab-a', url: 'https://target.example/', active: true }] },
      activePage: page('tab-a', 'https://target.example/'),
      capabilities: { pageTabs: true },
      async newPage(url) {
        calls.push(['newPage', url]);
        this.snapshot.pages = [...this.snapshot.pages, { id: 'tab-b', url, active: true }];
        this.activePage = page('tab-b', url);
      },
      async callTool(name, args) { calls.push([name, args]); return { text: 'ok' }; },
    },
  };
  const tool = BROWSER_TOOLS.find(t => t.name === 'browser_new_tab');
  assert.ok(tool, 'browser_new_tab must be exposed to the model');
  const result = await tool.run({ url: 'https://probe.example/' }, { browser: session.browser, signal: undefined });
  assert.deepEqual(calls, [['newPage', 'https://probe.example/']]);
  assert.match(result.text, /probe\.example/);
  assert.match(result.text, /tab-b/);
  assert.equal(session.browser.snapshot.pages.length, 2, '原有的标签页必须保留');
});

test('new tab without a running browser becomes the first tab', async () => {
  const opened = [];
  const browser = { running: false };
  const tool = BROWSER_TOOLS.find(t => t.name === 'browser_new_tab');
  const result = await tool.run({ url: 'https://first.example/' }, {
    browser,
    openBrowser: async ({ url }) => { opened.push(url); browser.running = true; browser.activePage = { url: () => url }; return { ok: true }; },
  });
  assert.deepEqual(opened, ['https://first.example/']);
  assert.match(result.text, /第一个标签页/);
});

test('tab selection rejects a page that is no longer listed', async () => {
  const tabs = new BrowserTabs({
    closing: false,
    workspace: { id: 'ws', revision: 1, projectRevision: 1, root: 'C:/ws' },
    browser: { generation: 1, running: true, snapshot: { pages: [{ id: 'tab-a', url: 'https://a.example/', active: true }] }, selectPage: async () => { throw new Error('不应被调用'); } },
  });
  await assert.rejects(tabs.select('missing'), /已关闭/);
  assert.equal(tabs.revision, 1);
});
