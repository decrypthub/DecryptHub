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
    return ctx.browser.callTool(tool.name, args, ctx.signal);
  },
}));
