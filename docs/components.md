# 可选组件安装

优先在桌面左侧「插件」完成官方组件安装、版本检查、配置与启停。WDH、IDH 和 ADH 为默认可选项；未安装时仍可处理文件、代码与自定义 MCP。

完整说明见 [插件管理](plugins.md)。当前官方包为预览版，WDH 支持 Windows/Linux x64，IDH/ADH 网关要求 Python 3.10+，设备插件由用户自行部署。

## 本地开发包

WDH 工作目录执行 npm ci --ignore-scripts、npm test、npm run build，再在 DecryptHub 中运行：

```sh
node scripts/install-component.mjs --from <WDH构建目录> --allow-local
```

显式本地安装会校验文件、平台与 API，不把本地 checksum 当作发布者签名。默认使用当前用户应用数据；开发调试可指定 DECRYPTHUB_DATA_DIR 为项目 .tmp/desktop-appdata/WebDecryptHub 的绝对路径，避免覆盖日常数据。

源码联调：

```sh
npm run check:wdh -- <独立WDH工作目录>
```

JSRA_DEV=1 时可通过 DECRYPTHUB_WDH_DIR 指定 WDH 源码。该开发路径不用于普通安装。
