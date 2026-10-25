# 执行器与 Windows 体验

日期：2026-10-24。

## 用户看到的目录

- 选择文件夹：文件工具和命令直接在该目录工作。
- 不选择文件夹：使用每个聊天独立的会话目录。该目录保留到应用数据中，重启仍在，不随系统临时目录清理。
- 工作文件夹菜单可复制真实路径；界面和模型使用同一个根。
- 历史、凭据、浏览器配置等属于应用内部数据，不是另一份项目文件。

现有聊天中的 `workspace/` 原地保留。切换目录不自动迁移文件。没有引入 Git worktree 或云执行；以后可作为独立运行位置增加。

## 标准权限

优先探测 SRT。可用时，由 OS 后端执行命令，并按工作区与网络策略限制。需要访问 registry 等目的地时显示审批。npm 默认 `--ignore-scripts`，需要生命周期脚本时应由用户审批明确命令。

不可用时，普通文件编辑仍可用。命令会显示“未隔离执行”并逐次审批；用户拒绝则不启动。这是有意的可用性降级，不应改成无提示放行。

Windows 当前需要上游的 sandbox 账户与 helper 初始化。可在可信终端按上游说明执行：

```powershell
npx --yes @anthropic-ai/sandbox-runtime@0.0.81 windows-install --skip-profile-grant
```

该命令会修改本机运行账户/权限配置，应用不自动执行。完成后在工作目录栏的环境详情中“重新检测”。以实际探测结果为准，不能只检查包是否安装。Windows 后端为实验能力，生产交付前应在专用测试机完成隔离验收。

上游说明：[sandbox-runtime](https://github.com/anthropics/sandbox-runtime)。本实现不复刻或调用 Codex 私有 Windows 沙箱。

## 开发与测试

建议 Node 24.16.0、Bun 1.4.4。Bun 编译产物关闭 `.env`、`bunfig.toml`、package.json 和 tsconfig 自动加载，避免工作目录里的配置影响可信宿主启动。

```powershell
npm run build:ui
node --test sidecar/test/*.test.mjs
node scripts/check-update-shutdown.mjs
npm run check:ui
npm run audit:ui
npm run check:desktop-browser
```

本机已有调试二进制时，关闭旧窗口后用 `npm run dev:desktop` 体验当前源码；原生代码变化后先运行 `scripts\build-desktop.cmd`。开发脚本使用 `.tmp/desktop-appdata`，与安装版数据分开。

Windows 生产构建运行 `bun scripts/build-sidecar.mjs win`，生成 `resources/sidecar/main.mjs`，由捆绑的 Node 24.16.0 运行；同时复制 executor 资源。Windows 安装包不再依赖 Bun 编译 exe。Linux 仍生成独立 sidecar。安装包体检检查 JS bundle、Node/npm、浏览器与 executor 资源，发布流水线使用真实捆绑 Node 跑 `node scripts/check-sidecar.mjs`。

2026-10-25 已定位并复现 Windows 启动故障：工作区继承低完整性标签，生成的桌面 EXE、捆绑 Node 和解压的浏览器代码也继承该标签；新进程以低完整性运行，导致 EPERM、Chrome 退出 `0x80000003`，以及 Cloak GPU 子进程的 `0xC0000022`。相同文件从系统路径启动成功，不能验证实际桌面链路。机制见 [Windows MIC 文档](https://learn.microsoft.com/en-us/windows/win32/secauthz/mandatory-integrity-control)。

构建和开发启动脚本仅将本项目指定 EXE 产物恢复为普通用户完整性；下载器在签名/摘要校验和安全解压后，仅准备浏览器代码目录的完整性及沙箱子进程读取权限。设置页提供旧托管内核的修复入口，拒绝链接及任意自定义路径。不会更改工作区、用户配置文件的完整性，也不会关闭 Chromium 沙箱。已运行的低完整性进程不会随文件修复而升级，必须关闭旧窗口，从普通终端重新执行 `npm run dev:desktop`。

真实捆绑 Node 已通过发布 JS bundle 的浏览器和 debugger 冒烟。`check:desktop-browser` 另用隐藏的原生调试窗口验证桌面 EXE → Node → 有头 Chrome/Cloak、DOM、请求响应体、调试源码，以及旧低完整性内核修复流程。用 `JSRA_SMOKE_CLOAK` 指定已验证的 Cloak 可执行文件时，会复制到独立测试数据目录，保留结果于 `.tmp/native-browser-*/results.json`；不会复用用户聊天及浏览器配置。

`JSRA_TEST_FIXTURES=1` 配合 `JSRA_TEST_NO_SANDBOX=1` 仅供本地集成测试稳定覆盖“缺少隔离后端 → 宿主审批”路径；它不授予任何执行权限。

## 验收范围

自动检查涵盖真实 WebSocket、模拟本地模型、真实子进程、目录凭证、文件变更和恢复、只读与逐次审批、浏览器 DOM 操作、MCP 连接竞态、ZIP 链接与体积限制、UI 两种主题。真实模型质量、Windows 隔离安装后的行为和原生交互需另行体验验证。详细边界见 [security.md](./security.md)。
