// Stable WDH API v1 descriptors; implementation lives exclusively in the WDH component.
import descriptors from './wdh-tools.json' with { type: 'json' };
export const BROWSER_TOOLS = descriptors.map((tool) => ({
  ...tool,
  component: 'wdh',
  run: async (args, ctx) => {
    if (tool.name === 'browser_open') {
      const result = await ctx.openBrowser(args);
      return result.ok
        ? { text: '当前页面：' + ctx.browser.activePage.url() }
        : { text: result.error, isError: true };
    }
    // 新标签页由宿主控制面负责：内核的 new_page 被刻意隐藏（导航只有一个选中页），
    // 但 BrowserManager 的 new-page 是现成的，这里只做接线。
    if (tool.name === 'browser_new_tab') {      if (!ctx.browser.running) {
        const result = await ctx.openBrowser(args);
        return result.ok ? { text: '浏览器此前未启动，已在当前页面打开：' + ctx.browser.activePage.url() + '（这是第一个标签页）' } : { text: result.error, isError: true };
      }
      if (!ctx.browser.capabilities?.pageTabs) return { text: '当前 WDH 组件版本不支持多标签页，请更新 WebDecryptHub 组件。', isError: true };
      const before = new Set(ctx.browser.snapshot.pages.map((p) => p.id));
      await ctx.browser.newPage(args.url);
      const pages = ctx.browser.snapshot.pages || [];
      const created = pages.find((p) => !before.has(p.id)) || pages.find((p) => p.active) || pages[pages.length - 1];
      return {
        text: `已在新标签页打开：${ctx.browser.activePage?.url?.() || args.url}（共 ${pages.length} 个标签页${created ? '，新标签页 id=' + created.id : ''}）。原标签页保持原状，可用 browser_select 切回。`,
      };
    }
    // 兜底自愈：调试状态与 CDP 打架时重建连接，页面与登录态保持不变。
    if (tool.name === 'browser_reset') {
      if (!ctx.browser.running) return { text: '浏览器尚未启动，无需重建。', isError: true };
      const page = ctx.browser.activePage?.url?.() || '';
      const value = await ctx.browser.control('debugger-rebind', { allowedRoot: ctx.workRoot });
      if (Array.isArray(value?.tools)) ctx.mcp.tools = value.tools;
      return {
        text: `已重建调试上下文（销毁并重新绑定 CDP target）。当前页面：${page || '未知'}；Cookie、已填表单与已捕获请求均保留。旧的 scriptId、断点与 reqid 视为失效，请重新 list_scripts / list_network_requests。`,
      };
    }
    return ctx.browser.callTool(tool.name, args, ctx.signal);
  },
}));
