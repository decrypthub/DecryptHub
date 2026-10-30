import path from 'node:path';

export async function checkSidebarBrowser({ page, rpc, scheme, shots, ok, projectId }) {
  const before = (await rpc('session-list')).focused, project = (await rpc('projects-list')).find(p => p.id === projectId);
  const field = () => page.getByRole('combobox', { name: '搜索项目与会话', exact: true });
  const options = page.locator('.session-search-results [role="option"]');
  const open = async query => { await page.keyboard.press('Control+k'); await field().waitFor(); await field().fill(query); };
  const target = await rpc('session-create', { projectId, title: '搜索内容示例 ' + scheme });
  await rpc('test-seed-history', { sessionId: target.id, events: [
    { t: 'user', id: 'sidebar-user', turnId: 'sidebar-turn', content: 'SIDEBAR_HISTORY_ONLY_' + scheme + '：检查已保存的消息内容。' },
    { t: 'assistant', id: 'sidebar-reply', turnId: 'sidebar-turn', content: '搜索示例回复。', phase: 'final_answer' },
    { t: 'turn-end', turnId: 'sidebar-turn', stop: 'completed' },
  ] });
  // Fixtures write saved history without emitting live model events. Restore it
  // through the normal startup snapshot before exercising search navigation.
  await page.reload(); await page.locator('.project-tree').waitFor();
  const group = page.locator(`[data-project-id="${projectId}"]`);
  await group.locator('.project-toggle').waitFor();
  if (await group.locator('.project-toggle').getAttribute('aria-expanded') === 'true') await group.locator('.project-toggle').click();
  await open(project.name);
  await options.filter({ hasText: project.name }).first().waitFor();
  ok(await page.locator(`.sidebar-search-result[data-result-kind="project"][data-result-id="${projectId}"]`).count() === 1, `[${scheme}] 项目名称应找到项目本身`);
  ok(await page.locator(`.sidebar-search-result[data-result-id="${target.id}"]`).count() === 1, `[${scheme}] 项目名称应覆盖折叠项目中的会话`);
  await field().press('ArrowDown');
  ok(await options.nth(1).getAttribute('aria-selected') === 'true', `[${scheme}] 搜索框下方向键应选择下一条结果`);
  await field().press('ArrowUp');
  ok(await options.first().getAttribute('aria-selected') === 'true', `[${scheme}] 搜索框上方向键应返回上一条结果`);
  await page.screenshot({ path: path.join(shots, scheme + '-sidebar-search-project.png') });
  await page.locator(`.sidebar-search-result[data-result-kind="project"][data-result-id="${projectId}"]`).click();
  await group.locator('.project-toggle[aria-expanded="true"]').waitFor();
  ok((await rpc('session-list')).focused === before, `[${scheme}] 选择项目搜索结果不能擅自切换会话`);
  await open(project.folders[0].root);
  ok(await page.locator(`.sidebar-search-result[data-result-kind="project"][data-result-id="${projectId}"]`).count() === 1, `[${scheme}] 应支持按目录搜索项目`);
  await field().press('Escape');
  await open('SIDEBAR_HISTORY_ONLY_' + scheme);
  const contentHit = page.locator(`.sidebar-search-result[data-result-id="${target.id}"]`);
  await contentHit.waitFor();
  ok((await contentHit.innerText()).includes(project.name) && (await contentHit.innerText()).includes('SIDEBAR_HISTORY_ONLY'), `[${scheme}] 历史命中应显示项目及消息摘录`);
  await page.screenshot({ path: path.join(shots, scheme + '-sidebar-search-content.png') });
  await field().press('Enter');
  await page.locator(`.session-item[data-session-id="${target.id}"].on`).waitFor();
  await page.locator('[data-turn-id="sidebar-turn"]').waitFor();
  ok(await group.locator('.project-toggle').getAttribute('aria-expanded') === 'true', `[${scheme}] 打开搜索结果后应展开并定位所属项目`);

  await page.getByRole('button', { name: '项目视图选项', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '全部会话', exact: true }).click();
  await page.locator('.project-tree.is-flat').waitFor();
  ok((await page.locator('.session-item.on .session-text').innerText()).includes(project.name), `[${scheme}] 单列表仍应标明项目归属`);
  await page.reload(); await page.locator('.project-tree.is-flat').waitFor();
  await page.getByRole('button', { name: '项目视图选项', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '按项目', exact: true }).click();
  await page.locator('.project-tree:not(.is-flat)').waitFor();
  await group.locator('.project-toggle').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '重命名项目', exact: true }).click();
  const rename = page.getByRole('dialog', { name: '重命名项目', exact: true }); await rename.waitFor();
  ok(await rename.getByRole('button', { name: '添加目录', exact: true }).count() === 0, `[${scheme}] 重命名项目应只编辑名称`);
  await rename.getByRole('button', { name: '取消', exact: true }).click();
  await page.locator('.session-item.on .session-focus').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '移动到项目…', exact: true }).waitFor();
  await page.keyboard.press('Escape');

  // Deliberately return an old query after a newer one has already matched.
  const world = await page.context().newCDPSession(page);
  try {
    await world.send('Runtime.evaluate', { expression: 'window.__sidebarInvoke=window.api.invoke;window.api.invoke=function(ch,args){if(ch==="session-search"&&args.query==="UI_STALE_SIDEBAR")return new Promise(resolve=>{window.__sidebarResolve=resolve;document.documentElement.dataset.sidebarPending="1"});return window.__sidebarInvoke(ch,args)};' });
    await open('UI_STALE_SIDEBAR');
    await page.waitForFunction(() => document.documentElement.dataset.sidebarPending === '1');
    await field().fill(project.name);
    await page.locator(`.sidebar-search-result[data-result-kind="project"][data-result-id="${projectId}"]`).waitFor();
    await world.send('Runtime.evaluate', { expression: `window.__sidebarResolve({matches:[{sessionId:${JSON.stringify(target.id)},projectId:${JSON.stringify(projectId)},excerpt:"STALE_SIDEBAR_EXCERPT"}],skipped:0})` });
    ok(!(await page.locator('.session-search-results').innerText()).includes('STALE_SIDEBAR_EXCERPT'), `[${scheme}] 旧搜索的晚到结果不能覆盖当前查询`);
    await page.getByRole('button', { name: '清除搜索', exact: true }).click();
    await field().waitFor({ state: 'detached' });
  } finally {
    await world.send('Runtime.evaluate', { expression: 'window.api.invoke=window.__sidebarInvoke;delete window.__sidebarInvoke;delete window.__sidebarResolve;delete document.documentElement.dataset.sidebarPending;' });
    await world.detach();
  }
  await page.getByRole('button', { name: '收起会话列表', exact: true }).click();
  await page.keyboard.press('Control+k'); await field().waitFor();
  ok(await page.locator('.rail').isVisible(), `[${scheme}] 侧栏收起时快捷键应展开侧栏并聚焦搜索`);
  await field().press('Escape');
  await rpc('session-focus', { sessionId: before }); await page.locator(`.session-item[data-session-id="${before}"].on`).waitFor();
}
