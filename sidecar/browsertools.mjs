// Stable WDH API v1 descriptors; implementation lives exclusively in the WDH component.
import descriptors from './wdh-tools.json' with { type: 'json' };
import { normalizeTargetUrl } from './url.mjs';
export const BROWSER_TOOLS = descriptors.map((tool) => ({
  ...tool,
  component: 'wdh',
  run: async (args, ctx) => {
    if (tool.name === 'browser_new_tab') {
      const url = normalizeTargetUrl(args?.url);
      if (!url) return { text: '需要有效网址', isError: true };
      await ctx.browser.newPage(url);
      return { text: '新标签页已打开：' + (ctx.browser.activePage?.url() || url) };
    }
    if (tool.name === 'browser_open') {
      const result = await ctx.openBrowser(args);
      return result.ok
        ? { text: '当前页面：' + ctx.browser.activePage.url() }
        : { text: result.error, isError: true };
    }
    return ctx.browser.callTool(tool.name, args, ctx.signal);
  },
}));
