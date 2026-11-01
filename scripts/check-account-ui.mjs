import path from 'node:path';

// Safe native snapshots only: this fixture never signs in, stores credentials,
// opens an external browser, or submits feedback.
export async function checkAccountMenu({ browser, baseUrl, wsPort, scheme, shots, ok }) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: scheme });
  try {
    // Chromium's network-access check treats the synthetic native bridge as a
    // separate caller. Grant only this disposable fixture's loopback origin.
    await context.grantPermissions(['local-network-access'], { origin: baseUrl });
    await context.addInitScript(({ wsPort }) => {
      window.__JSRA_NATIVE_TITLEBAR = true;
      window.__JSRA_DEBUG = true;
      window.__accountCalls = [];
      window.__accountPort = wsPort;
      window.__nativeCalls = [];
      window.__accountFixture = { available: true, phase: 'signed-out', profile: null, error: null };
      window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' } }, transformCallback: () => 0, unregisterCallback: () => {}, invoke: async command => {
        window.__nativeCalls.push(command);
        if (command === 'get_ws_port') return wsPort;
        if (command === 'get_ws_token') return 'ui-check';
        if (command === 'app_info') return { name: 'UI fixture', version: 'test', os: 'macos', arch: 'arm64' };
        if (command === 'account_avatar') return null;
        if (command.startsWith('account_')) {
          window.__accountCalls.push(command);
          if (command === 'account_login') window.__accountFixture.phase = 'waiting-browser';
          if (command === 'account_logout' && window.__accountLogoutFailure) throw 'UI退出失败';
          if (command === 'account_cancel' || command === 'account_logout') window.__accountFixture = { available: true, phase: 'signed-out', profile: null, error: null };
          return JSON.parse(JSON.stringify(window.__accountFixture));
        }
        return null;
      } };
    }, { wsPort });
    const page = await context.newPage();
    page.on('console', message => { if (message.type() === 'error') console.error('Account fixture console:', message.text().slice(0, 350)); });
    await page.goto(baseUrl + '/?port=' + wsPort + '&token=ui-check');
    // patchright evaluates page.evaluate() in an isolated world, where the app's
    // window globals are invisible. Native state assertions must run in the main
    // world, so drive them through the page's own CDP session.
    const cdp = await context.newCDPSession(page);
    const evalMain = async expression => {
      const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text || 'evaluate failed');
      return result.value;
    };
    await page.locator('.rail-bottom .rail-account').waitFor();
    const skip = page.getByRole('button', { name: '稍后', exact: true }); if (await skip.count()) await skip.click();
    await page.getByRole('button', { name: '更多', exact: true }).click();
    await page.getByRole('menuitem', { name: '登录', exact: true }).waitFor({ state: 'visible' });
    ok(await page.getByRole('menuitem').count() === 3, `[${scheme}] 更多菜单应只有设置、意见反馈和登录`);
    ok(await page.getByRole('menuitem', { name: '意见反馈', exact: true }).getAttribute('href') === 'https://github.com/decrypthub/DecryptHub/issues/new/choose', `[${scheme}] 反馈应指向真实公开入口`);
    await page.screenshot({ path: path.join(shots, scheme + '-account-more.png') });
    await evalMain(`(() => {
      const original = window.api.invoke;
      window.__feedbackCalls = [];
      window.api.invoke = (channel, args) => { if (channel === 'feedback-open') { window.__feedbackCalls.push(args || {}); return Promise.resolve({ opened: true }); } return original(channel, args); };
    })()`);
    await page.getByRole('menuitem', { name: '意见反馈', exact: true }).click();
    await page.getByRole('menuitem').first().waitFor({ state: 'detached' });
    ok(await evalMain('window.__feedbackCalls.length === 1 && Object.keys(window.__feedbackCalls[0]).length === 0'), `[${scheme}] 反馈导航不能附带项目、会话或诊断载荷`);
    await page.getByRole('button', { name: '更多', exact: true }).click();
    await page.getByRole('menuitem', { name: '登录', exact: true }).click();
    await page.getByText('请在浏览器中确认登录', { exact: true }).waitFor();
    ok(await evalMain("window.__accountCalls.filter(c => c === 'account_login').length === 1"), `[${scheme}] 登录菜单应直接发起一次网页授权`);
    await page.getByRole('button', { name: '更多', exact: true }).click();
    await page.getByRole('menuitem', { name: '继续登录', exact: true }).click();
    ok(await evalMain("window.__accountCalls.filter(c => c === 'account_login').length === 1"), `[${scheme}] 等待期间不能重复创建授权请求`);
    await evalMain("window.__accountFixture.phase = 'signed-in'; window.__accountFixture.profile = { id: 'ui-account', nickname: 'UI账号测试', handle: 'ui-account', avatarUrl: null };");
    const account = page.getByRole('button', { name: '账号菜单', exact: true }); await account.waitFor();
    ok((await account.innerText()).includes('UI账号测试'), `[${scheme}] 已登录入口应显示昵称`);
    await account.click();
    await page.getByRole('menuitem', { name: '退出登录', exact: true }).waitFor();
    ok(await page.getByRole('menuitem').count() === 3, `[${scheme}] 已登录菜单应保持相同的三个入口`);
    await page.screenshot({ path: path.join(shots, scheme + '-account-signed-in.png') });
    await evalMain('window.__accountLogoutFailure = true');
    await page.getByRole('menuitem', { name: '退出登录', exact: true }).click();
    await page.getByText('UI退出失败', { exact: true }).first().waitFor();
    // 失败后仍应保持已登录状态：以侧栏入口的标签和昵称为准（设置页覆盖时 isVisible 不可靠）。
    await page.keyboard.press('Escape');
    const rail = page.locator('.rail-account').first();
    const labelOk = await rail.getAttribute('aria-label') === '账号菜单';
    const nicknameOk = (await rail.innerText()).includes('UI账号测试');
    ok(labelOk && nicknameOk, `[${scheme}] 凭据删除失败时不能假装退出登录`);
    await evalMain('window.__accountLogoutFailure = false');
    await account.click(); await page.getByRole('menuitem', { name: '退出登录', exact: true }).click();
    await page.getByRole('button', { name: '更多', exact: true }).waitFor();
  } catch (error) {
    const page = context.pages()[0]; if (page) {
      await page.screenshot({ path: path.join(shots, scheme + '-account-failure.png') }).catch(() => {});
      const session = await context.newCDPSession(page);
      console.error('Account fixture diagnostics:', (await session.send('Runtime.evaluate', { expression: 'JSON.stringify({port:window.__accountPort,calls:window.__nativeCalls,debug:window.__JSRA_DBGTXT})', returnByValue: true })).result.value);
      await session.detach();
    }
    throw error;
  } finally { await context.close(); }
}
