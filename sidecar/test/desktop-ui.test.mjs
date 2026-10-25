import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationMarkdown } from '../transcript.mjs';
import { handleWindowDrag } from '../../ui/src/window-drag.js';

test('Markdown sharing preserves messages, tool arguments/results and IDs without internal prompts or reasoning', () => {
  const md = conversationMarkdown({ id: 's-fixture', title: '登录接口分析', events: [
    { t: 'system', content: 'PRIVATE_SYSTEM' },
    { t: 'user', turnId: 'run-fixture', displayContent: '定位签名函数', content: '定位签名函数\n\n【当前状态】PRIVATE_STATE', attachments: [{ id: 'image-fixture', name: '页面.png' }] },
    { t: 'assistant', phase: 'commentary', content: '先读取脚本。', reasoning: 'PRIVATE_REASONING', calls: [{ id: 'reused-id', itemId: 'item-1', name: 'workspace_read', args: { path: 'main.js' } }] },
    { t: 'tool', itemId: 'item-1', name: 'workspace_read', content: '```js\nconst signature = 42;\n```' },
    { t: 'user', content: '【系统】PRIVATE_BUDGET_NOTE' },
    { t: 'assistant', content: '已定位签名函数。' },
    { t: 'turn-end', turnId: 'run-fixture', stop: 'completed' },
  ] });
  for (const value of ['s-fixture', 'run-fixture', '定位签名函数', '先读取脚本', 'workspace_read', 'main.js', 'item-1', 'const signature = 42', '页面.png', 'image-fixture']) assert.ok(md.includes(value), value);
  assert.ok(!md.includes('PRIVATE_')); assert.ok(md.includes('````\n```js')); assert.ok(md.includes('<details>'));
});
test('Markdown handles old notes, failed results, partial output and empty sessions', () => {
  const md = conversationMarkdown({ id: 'legacy', events: [{ t: 'user', content: '用户原文\n\n【当前状态】private' }, { t: 'tool', name: 'run', isError: true, content: '失败原文' }, { t: 'assistant', phase: 'partial_answer', content: '正在输出的文字' }] });
  assert.ok(md.includes('用户原文')); assert.ok(!md.includes('private')); assert.ok(md.includes('失败原文')); assert.ok(md.includes('尚未完成'));
  assert.ok(conversationMarkdown({ id: 'empty' }).includes('empty'));
});
test('all titlebar text descendants drag while interactive descendants keep their own input', () => {
  const actions = [], bridge = { startDragging: () => actions.push('drag'), toggleMaximize: () => actions.push('maximize') };
  const event = (interactive, extra = {}) => ({ button: 0, detail: 1, target: { closest: () => interactive ? {} : null }, preventDefault() { this.prevented = true; }, ...extra });
  const text = event(false); handleWindowDrag(text, bridge); assert.equal(text.prevented, true);
  handleWindowDrag(event(false, { detail: 2 }), bridge);
  for (const candidate of [event(true), event(false, { button: 2 }), event(false, { defaultPrevented: true })]) { handleWindowDrag(candidate, bridge); assert.equal(candidate.prevented, undefined); }
  assert.deepEqual(actions, ['drag', 'maximize']);
});
