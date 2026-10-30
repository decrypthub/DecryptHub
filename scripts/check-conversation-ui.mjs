import path from 'node:path';

// Runs against the real UI/sidecar with disposable local records, never a provider.
export async function checkConversationNavigation({ page, rpc, scheme, shots, ok }) {
  const sid = (await rpc('session-list')).focused, saved = await rpc('session-snapshot', { sessionId: sid });
  const fixture = Array.from({ length: 120 }, (_, i) => [
    { t: 'user', id: 'rail-user-' + i, turnId: 'rail-turn-' + i, at: Date.now() - (120 - i) * 10000, content: `索引示例第 ${i + 1} 轮：检查项目文件和工具结果。` },
    { t: 'assistant', id: 'rail-process-' + i, turnId: 'rail-turn-' + i, phase: 'commentary', content: '先检查证据，再给出结果。', calls: [{ id: 'rail-call-' + i, itemId: 'rail-item-' + i, name: 'workspace_read', args: { path: 'src/long-filename-for-navigation-check.js' } }, ...(i === 0 ? Array.from({ length: 5 }, (_, n) => ({ id: 'rail-extra-' + n, itemId: 'rail-extra-' + n, name: 'workspace_read', args: { path: `src/check-${n}.js` } })) : [])] },
    { t: 'tool', turnId: 'rail-turn-' + i, id: 'rail-call-' + i, itemId: 'rail-item-' + i, content: '示例文件内容\n'.repeat(i === 0 ? 120 : 1), ms: 42 },
    ...(i === 0 ? Array.from({ length: 5 }, (_, n) => ({ t: 'tool', turnId: 'rail-turn-0', id: 'rail-extra-' + n, itemId: 'rail-extra-' + n, content: 'fixture verified', ms: 10 })) : []),
    { t: 'assistant', id: 'rail-answer-' + i, turnId: 'rail-turn-' + i, phase: 'final_answer', content: `第 ${i + 1} 轮的模型回复。\n\n已核对文件，执行结果与任务一致。` },
    { t: 'turn-end', turnId: 'rail-turn-' + i, stop: 'completed' },
  ]).flat();
  const agents = [
    { id: 'rail-agent-first', parentRunId: 'rail-turn-0', title: '索引示例：第一轮研究子代理', task: '检查第一轮', status: 'completed', summary: 'FIRST_AGENT_RESULT：第一轮的独立结论。' },
    { id: 'rail-agent-last', parentRunId: 'rail-turn-119', title: '索引示例：最后一轮研究子代理', status: 'completed', summary: 'LAST_AGENT_RESULT：最后一轮的独立结论。' },
    { id: 'rail-agent-orphan', parentRunId: null, title: '索引示例：独立研究任务', status: 'failed', summary: 'ORPHAN_AGENT_RESULT：保留在会话入口，不猜测所属轮次。' },
  ];
  try {
    await rpc('test-seed-history', { sessionId: sid, events: fixture, subagents: agents });
    await page.reload(); await page.locator('.conversation-turn').nth(119).waitFor({ state: 'attached' });
    const nav = page.getByRole('navigation', { name: '对话轮次索引', exact: true });
    await nav.waitFor();
    const shortTurn = page.locator('[data-turn-id="rail-turn-1"]');
    ok(await shortTurn.locator('.turn-process > summary:not([hidden])').count() === 1 && await shortTurn.locator('.tool-head').count() === 0, `[${scheme}] 结束的轮次应收成一行摘要`);
    await shortTurn.locator('.turn-process > summary').click();
    ok(await shortTurn.locator('.tool-head').count() === 1, `[${scheme}] 展开摘要后应看到工具过程`);
    ok(await page.locator('.composer-wrap .subagent-row, .composer-wrap .harness-agents').count() === 0, `[${scheme}] 子代理不能占据输入区`);
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1080, height: 680 }, { width: 580, height: 640 }]) {
      await page.setViewportSize(viewport);
      await page.locator('.msgs').evaluate(el => { el.style.scrollBehavior = 'auto'; el.scrollTop = 0; });
      await page.waitForFunction(() => document.querySelector('.turn-nav-mark[aria-current]')?.getAttribute('aria-label')?.startsWith('第 1 轮：'));
      const band = await page.locator('.transcript').boundingBox(), bounds = await nav.boundingBox(), composer = await page.locator('.composer-wrap').boundingBox();
      ok(bounds.y >= band.y && bounds.y + bounds.height <= Math.min(band.y + band.height, composer.y) + 1, `[${scheme}] ${viewport.width} 轮次索引不能越过消息区`);
      ok(bounds.height <= 420 && await nav.locator('button').count() < 50, `[${scheme}] 百轮索引应固定间距并限制渲染数量`);
      ok(await page.locator('.chat').evaluate(el => el.scrollWidth <= el.clientWidth + 1), `[${scheme}] ${viewport.width} 对话区不能横向溢出`);
      const first = nav.locator('button[aria-current]');
      await first.hover(); await page.getByRole('tooltip').filter({ hasText: '第 1 / 120 轮' }).waitFor();
      await first.focus(); await first.press('End');
      await page.getByRole('button', { name: /^第 120 轮：/ }).press('Enter');
      await page.waitForFunction(() => document.querySelector('.turn-nav-mark[aria-current]')?.getAttribute('aria-label')?.startsWith('第 120 轮：'));
      const last = nav.locator('button[aria-current]'); await last.press('Home');
      await page.getByRole('button', { name: /^第 1 轮：/ }).press('Enter');
      await page.waitForFunction(() => document.querySelector('.turn-nav-mark[aria-current]')?.getAttribute('aria-label')?.startsWith('第 1 轮：'));
      await page.locator('.conversation-turn').first().locator('.turn-process > summary').click();
      const child = page.locator('.conversation-turn').first().locator('.subagent-row'); await child.waitFor();
      ok(await child.getAttribute('data-agent-id') === 'rail-agent-first', `[${scheme}] 子代理必须属于正确轮次`);
      await page.locator('.conversation-turn').first().locator('.tool-head').first().click();
      const output = page.getByRole('region', { name: '工具输出', exact: true }).locator('pre');
      ok(await output.evaluate(el => el.scrollHeight > el.clientHeight && el.clientHeight <= 220), `[${scheme}] 长工具输出必须独立滚动`);
      await page.getByRole('button', { name: '复制工具输入', exact: true }).click();
      ok((await page.evaluate(() => navigator.clipboard.readText())).includes('long-filename-for-navigation-check.js'), `[${scheme}] 工具输入应完整复制`);
      await page.screenshot({ path: path.join(shots, scheme + '-turn-navigation-' + viewport.width + '.png') });
      await page.locator('.conversation-turn').first().locator('.turn-process > summary').click();
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    const before = await page.locator('.composer').boundingBox();
    await page.getByRole('button', { name: '查看子代理', exact: true }).click();
    await page.locator('.subagents-list .subagent-row').nth(2).waitFor();
    ok(await page.locator('.subagents-list .subagent-row').count() === 3, `[${scheme}] 无归属子代理仍可从顶部查看`);
    const after = await page.locator('.composer').boundingBox();
    ok(Math.abs(before.y - after.y) < 1 && Math.abs(before.height - after.height) < 1, `[${scheme}] 展开子代理不能挤压输入区`);
    await page.locator('.subagents-list [data-agent-id="rail-agent-first"] button').first().click();
    await page.locator('.subagent-result').filter({ hasText: 'FIRST_AGENT_RESULT' }).waitFor();
    await page.getByRole('button', { name: '关闭子代理详情', exact: true }).click();
    await page.locator('.subagent-detail').waitFor({ state: 'detached' });
    await page.locator('.subagents-list [data-agent-id="rail-agent-last"] button').first().click();
    await page.locator('.subagent-result').filter({ hasText: 'LAST_AGENT_RESULT' }).waitFor();
    ok(!await page.locator('.subagent-result:visible').innerText().then(t => t.includes('FIRST_AGENT_RESULT')), `[${scheme}] 子代理结果不能串用`);
    await page.screenshot({ path: path.join(shots, scheme + '-subagents-compact.png') });
    await page.getByRole('button', { name: '关闭子代理详情', exact: true }).click();
    await page.locator('.subagent-detail').waitFor({ state: 'detached' });
    // Hold one result until another agent is open, proving late replies are discarded.
    const world = await page.context().newCDPSession(page);
    try {
      await world.send('Runtime.evaluate', { expression: 'window.__railInvoke=window.api.invoke; window.api.invoke=function(channel,args){if(channel==="subagent-result"&&args.id==="rail-agent-first")return new Promise(resolve=>{window.__railLate=resolve;document.documentElement.dataset.railPending="1";});return window.__railInvoke(channel,args);};' });
      await page.locator('.subagents-list [data-agent-id="rail-agent-first"] button').first().click();
      await page.waitForFunction(() => document.documentElement.dataset.railPending === '1');
      await page.getByRole('button', { name: '关闭子代理详情', exact: true }).click();
      await page.locator('.subagent-detail').waitFor({ state: 'detached' });
      await page.locator('.subagents-list [data-agent-id="rail-agent-last"] button').first().click();
      await page.locator('.subagent-result').filter({ hasText: 'LAST_AGENT_RESULT' }).waitFor();
      await world.send('Runtime.evaluate', { expression: 'window.__railLate({id:"rail-agent-first",summary:"STALE_AGENT_RESULT"});' });
      ok(!await page.locator('.subagent-result:visible').innerText().then(t => t.includes('STALE_AGENT_RESULT')), `[${scheme}] 晚到的旧子代理结果不能写入当前详情`);
    } finally {
      await world.send('Runtime.evaluate', { expression: 'window.api.invoke=window.__railInvoke;delete window.__railInvoke;delete window.__railLate;delete document.documentElement.dataset.railPending;' });
      await world.detach();
    }
    const other = await rpc('session-create', { projectId: (await rpc('session-list')).sessions.find(s => s.id === sid).projectId, title: '轮次隔离示例' });
    await rpc('session-focus', { sessionId: other.id }); await page.locator('.welcome').waitFor();
    ok(await page.locator('.turn-nav, .subagent-detail, .subagents-popover').count() === 0, `[${scheme}] 切换会话必须关闭旧轮次索引及子代理面板`);
  } finally {
    await rpc('test-seed-history', { sessionId: sid, events: saved.events, subagents: [] });
    await rpc('session-focus', { sessionId: sid }); await page.reload(); await page.locator('.stage-identity').waitFor();
  }
}
