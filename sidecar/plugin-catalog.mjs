// Official plugin metadata is code-owned. RPC callers choose an ID, never a repository or command.
export const OFFICIAL_PLUGINS = Object.freeze([
  {
    id: 'wdh',
    name: 'WebDecryptHub',
    shortName: 'WDH',
    repository: 'decrypthub/WebDecryptHub',
    icon: 'globe',
    runtime: 'node',
    description: '浏览网页、抓取请求、调试脚本与观测指纹。',
    note: '使用系统 Chrome / Edge，或在插件中下载 CloakBrowser。',
  },
  {
    id: 'idh',
    name: 'IOSDecryptHub',
    shortName: 'IDH',
    repository: 'decrypthub/idh-cli',
    deviceRepository: 'decrypthub/IOSDecryptHub',
    icon: 'mobile',
    runtime: 'python',
    description: '连接 iOS 设备，通过官方 MCP 网关分析 App。',
    note: '需 Python 3.10+；设备端插件由你自行部署，填写设备服务地址后连接。',
  },
  {
    id: 'adh',
    name: 'AndroidDecryptHub',
    shortName: 'ADH',
    repository: 'decrypthub/adh-cli',
    deviceRepository: 'decrypthub/AndroidDecryptHub',
    icon: 'mobile',
    runtime: 'python',
    description: '连接 Host ADH Daemon，通过 MCP 分析 Android App。',
    note: '需 Python 3.10+；设备插件和 Host Daemon 由你自行配置。',
  },
]);
export const officialPlugin = (id) => {
  const plugin = OFFICIAL_PLUGINS.find((p) => p.id === id);
  if (!plugin) throw Error('未知官方插件');
  return plugin;
};
export const managedServerName = (id) => 'decrypthub_' + officialPlugin(id).id;
