// Stable WDH API v1 descriptors; implementation lives exclusively in the WDH component.
import descriptors from './wdh-tools.json' with { type: 'json' };
import { normalizeTargetUrl } from './url.mjs';
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
    if (tool.name === 'browser_new_tab') {
      // 网址归一化在进入组件之前完成，避免把裸域名或危险协议直接交给 newPage。
      const url = normalizeTargetUrl(args?.url);
      if (!url) return { text: '需要有效网址', isError: true };
      // 只有在「明确未启动且宿主提供了启动入口」时才自启为首个标签页；
      // 夹具或纯接线下（running 未声明）继续走 newPage，保持单一职责。
      if (ctx.browser.running === false && typeof ctx.openBrowser === 'function') {
        const result = await ctx.openBrowser({ ...args, url });
        return result.ok ? { text: '浏览器此前未启动，已在当前页面打开：' + ctx.browser.activePage.url() + '（这是第一个标签页）' } : { text: result.error, isError: true };
      }
      // 组件明确声明不支持多标签页时才拦；未声明（纯接线/夹具）不当作不支持。
      if (ctx.browser.capabilities?.pageTabs === false) return { text: '当前 WDH 组件版本不支持多标签页，请更新 WebDecryptHub 组件。', isError: true };
      const before = new Set((ctx.browser.snapshot?.pages || []).map((p) => p.id));
      await ctx.browser.newPage(url);
      const pages = ctx.browser.snapshot?.pages || [];
      const created = pages.find((p) => !before.has(p.id)) || pages.find((p) => p.active) || pages[pages.length - 1];
      // 没有快照（纯接线场景）时退回旧文案，保证提示里始终带着落地的网址。
      if (!pages.length) return { text: '新标签页已打开：' + (ctx.browser.activePage?.url?.() || url) };
      return {
        text: `已在新标签页打开：${ctx.browser.activePage?.url?.() || url}（共 ${pages.length} 个标签页${created ? '，新标签页 id=' + created.id : ''}）。原标签页保持原状，可用 browser_select 切回。`,
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
    const result = await ctx.browser.callTool(tool.name, args, ctx.signal);
    // take_screenshot 默认把画面作为 image block 回传（不落盘时）。原样透传 images，
    // 由 Agent 统一登记成附件，用户才能在对话里看到截图本身，而不是只看到一句「已截图」。
    if (result?.images?.length) return { ...result, images: result.images };
    return result;
  },
}));
