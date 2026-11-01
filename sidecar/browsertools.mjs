// Stable WDH API v1 descriptors; implementation lives exclusively in the WDH component.
import descriptors from './wdh-tools.json' with { type: 'json' };
import fs from 'node:fs';
import { workspacePath } from './workspaces.mjs';
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
    if (tool.name === 'browser_upload') {
      const page = ctx.browser.activePage;
      if (!page || page.isClosed()) return { text: '请先用 browser_open 打开网页', isError: true };
      const file = workspacePath(ctx, args?.path);
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return { text: '工作区文件不存在：' + args?.path, isError: true };
      if (fs.statSync(file).size > 200 * 1024 * 1024) return { text: '文件超过 200MB，无法上传', isError: true };
      await page.locator(args.selector).setInputFiles(file, { timeout: 15000 });
      return { text: '已把文件选择到表单：' + args.path + '（' + fs.statSync(file).size + ' 字节）' };
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
