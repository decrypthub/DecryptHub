# DecryptHub

通用桌面 Agent Harness。可在用户选择的文件夹中工作，也可使用随聊天保留的独立目录。支持模型配置、权限审批、图片附件、工具调用、目标任务、子代理和外部 MCP。

浏览器分析已拆为独立的 [WebDecryptHub](https://github.com/decrypthub/WebDecryptHub) 组件。在左侧「插件」按需下载安装 WDH、IDH/ADH 网关或配置自己的 MCP；未安装官方插件时，文件、代码和通用 MCP 任务仍可使用。WDH 安装后提供浏览器、网络请求、脚本调试及 Agent 控制光效。

## 开发

要求 Node.js 24、Rust stable，以及 [Tauri 系统依赖](https://v2.tauri.app/start/prerequisites/)。Windows 本机脚本使用 MSVC Build Tools 和 clang-cl。

```sh
npm ci --ignore-scripts
npm --prefix sidecar ci --ignore-scripts
npm run build:ui
node --test sidecar/test/*.test.mjs
```

Windows 调试：先运行 `scripts/build-desktop.cmd`，然后 `npm run dev:desktop`。脚本使用 `.tmp/desktop-appdata/WebDecryptHub` 保存开发聊天，与日常数据分开。开发模式需要 Node 在 PATH 中。

Windows 核心打包：

```sh
node scripts/prepare-node.mjs
npx --yes bun@1.4.4 scripts/build-sidecar.mjs win
node scripts/check-sidecar.mjs
```

核心包包含 Node/npm 和执行器依赖，不包含 WDH、浏览器二进制或 js-reverse-mcp。正式安装包还需 Tauri 构建与签名，本轮不发布安装包。

## 可选组件

- [组件安装及联调](docs/components.md)
- [拆分边界、生命周期与版本协议](docs/component-architecture.md)
- [权限和安全边界](docs/security.md)
- [执行器](docs/executor.md)
- [第三方声明](THIRD_PARTY_NOTICES.md)

IDH / ADH 已通过各自官方 CLI/MCP 网关接入插件中心，支持版本检查、下载、校验、配置和启停；Python 3.10+ 及设备插件/Host 服务由用户准备。详见 [插件管理](docs/plugins.md)。

旧桌面应用的应用标识、凭据库和默认 `WebDecryptHub` 数据目录暂时保留，以兼容已有配置与会话。产品名称和更新源改为 DecryptHub；网页分析项目保留 WebDecryptHub 名称。

MIT。源自 decrypthub/WebDecryptHub 的桌面开发快照，原始仓库和用户未提交的工作保持不变。
