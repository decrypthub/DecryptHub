# DecryptHub：工作标签页改造与 Mac 接续交接

更新时间：2026-10-28（中国时区）。这是开发中检查点，不代表本轮已完成验收或已合并。

## 接续任务

用户决定自行体验 Windows 版本，将 Codex 移到 Mac 继续开发，避免桌面自动化影响当前电脑。此时不要继续控制 Windows 桌面、关闭用户窗口或启动新一轮有头自动化。先读本文、仓库 AGENTS.md、docs/component-architecture.md、docs/browser-architecture.md、docs/security.md、docs/workspace-tabs.md，再核对实际代码与 Git 状态。

当前目标：完成紧凑菜单、每会话右侧多标签、文件/Markdown 阅读、浏览器与网络请求子视图、真实交互终端；解决已发现的浏览器显示恢复问题，补完验证后再提交 PR/合并。Mac 适配先走源码与串流路径，不同时更换 UI 框架和浏览器架构。

## 仓库和版本

| 仓库 | Windows 工作目录 | 当前状态 |
|---|---|---|
| https://github.com/decrypthub/DecryptHub | `X:\Project\github\DecryptHub-Desktop` | 本轮分支 `codex/workspace-tabs-and-compact-menus`，基于 main `2168c4bcfe58e4f2bdbc7e790b572f33be670a11`；交接检查点推送此分支，尚未合并 |
| https://github.com/decrypthub/WebDecryptHub | `X:\Project\github\WebDecryptHub-Runtime` | main `bc103f33c9b44b52e102de50fb1c3056718a1777`，工作区干净 |
| 旧融合仓库 | `X:\Project\github\WebDecryptHub` | 存在大量用户未提交改动；不是本轮桌面主仓库，不重置、不清理、不覆盖 |

WDH PR #6 已合并：https://github.com/decrypthub/WebDecryptHub/pull/6 。Release v0.1.1 已发布：https://github.com/decrypthub/WebDecryptHub/releases/tag/v0.1.1 。包含 Windows/Linux x64 组件 ZIP 及 SHA-256，**没有 macOS 制品**。API 仍为 1，hello 新增 `capabilities.pageTabs`，支持稳定 page ID 选择和关闭真实页面。

桌面 main 现有版本为 1.4.0，本轮尚未做桌面正式发布或安装包。不要把 main 当成本轮完整代码；Mac 必须检出上述工作分支。WDH 必须至少使用上述提交/0.1.1，0.1.0 不支持新增多标签控制。

## 本轮实现

- 权限切换改 Radix DropdownMenu；执行环境详情单独按需查看，完全访问的首次明确确认与后端权限规则保留。项目菜单保留搜索/新建/选择目录/不在目录工作，复制路径移到文件根工具栏。
- `ui/src/dock-tabs.js`、`use-workspace-tabs.jsx`：稳定标签 ID，目录/文档/浏览器/终端四种类型；可多开和独立关闭。每会话保存顺序与活动标签；存储 key 兼容旧版，payload v1 迁移为 v2。关闭阅读标签不删除磁盘文件。
- `dock.jsx`：动态标签栏、添加菜单、活动标签自动滚入可见区。浏览器内部为“网页 / 网络请求”，请求数据仍属于会话，筛选属于标签。多个目录标签保留各自浏览状态。
- `documents.mjs`、`document-panel.jsx`：工作区约束的文件读取、Markdown 预览/源码、相对文档链接；旧工作区文档不能读取新目录中的同名文件。消息 Markdown 链接与本轮文件产出可打开右侧标签；过滤危险 URL 协议。
- `browser-tabs.mjs`：按 page ID 串行选择/导航/关闭，工作区与浏览器 generation 租约防过期。控制和显示分离；显示继续由 BrowserSurface 排队，不向目标网页注入光晕。
- `terminals.mjs`、`terminal-process.mjs`、`terminal-entry.cjs`、`terminal-panel.jsx`：xterm.js + node-pty 真实 PTY。原生 PTY 放独立 Node worker，修复 Windows ConPTY 残留线程导致测试/退出挂住。标准模式显式批准宿主终端，只读拒绝，完全访问直接启动；用户终端审批不会改变无关 Agent Run。关闭标签/会话、切目录、改权限取消所属进程。界面重载可重连，应用重启不自动执行 shell。
- 打包增加终端 worker、node-pty 原生文件和许可证；CI Linux 显式 rebuild node-pty。桌面集成测试固定新 WDH 提交。

## 未完成和已知问题（先看这里）

1. **Windows 原生浏览器恢复问题待复验。** 在真实 Tauri 中，网页 → 网络请求 → 网页后出现“原生窗口已嵌入”占位而无真实页面；等待后也未恢复。初次导航、显示与网络视图隐藏曾正常。
2. 最新候选修复在 `ui/src/bus.jsx`：增加 `viewElement` state 与稳定的 `bindViewport` callback ref，画面尺寸和 BrowserSurface effects 依赖实际 DOM 挂载。原先仅依赖标签/side 状态，可能在 Radix 内容延迟挂载前读到空 ref。**这是候选原因和修复，尚不能宣称根因已证实或修复已通过。** 新 UI 和原生 EXE 已构建。
3. 再次打开隔离原生验收时，用户按物理 Esc 停止 Computer Use，未取得候选修复的原生结果。后续用户要求转 Mac，不再继续占用 Windows 桌面。Mac 串流测试不能替代 Windows 原生显示验收；可由用户验证并提供结果。
4. **最新完整 UI 回归失败，不能写“最终全部通过”。** 日志 `.tmp-tabs-ui-viewport.log`：dark 主题在 `scripts/check-ui.mjs:530` 等待“测试所选内核”按钮 click 超时；尚未跑到本轮浏览器恢复场景。先复现/查配置面板状态，不能直接跳过或调宽断言。候选修复前的 `.tmp-tabs-ui-verified.log` 曾双主题全通过。
5. 尚未创建桌面本轮 PR、跑远端本轮 CI或合并。交接只保存 WIP 检查点。之前授权完成测试后合并相关改动仍有效，但必须如实通过相应验证。

## 验证证据

| 检查 | 当前结果 / 范围 |
|---|---|
| `node --test sidecar/test/*.test.mjs` | 最新 229/229，约 9.6 秒；`.tmp-tabs-tests-final.log` |
| `npm run build:ui`、`npm run audit:ui` | 候选 ref 修复后通过 |
| `npm run check:ui` | 修复前深浅主题通过；修复后最新失败如上，不等同于原生验收 |
| Windows `cargo build` 与具名构建产物完整性准备 | 候选修复后通过；无本轮 Rust 源码变更 |
| `npm run check:powershell` | 本轮已通过；启动脚本保持 ASCII 兼容 PowerShell 5.1 |
| Windows 捆绑 Node/JS bundle 的 `check-sidecar.mjs` | 本轮真实 PTY 输入/输出/关闭及退出检查已通过；有新相关代码改动须重跑 |
| `npm run check:wdh -- ../WebDecryptHub-Runtime` | 最新通过：独立 MCP、DOM、抓包、调试 |
| Windows `check-desktop-browser.mjs` | 最新候选 ref 修复**之前**通过：正常完整性、真实有头浏览器、DOM、抓包、调试、Chromium sandbox 参数检查；不覆盖标签切换 UI |
| 人工原生 UI | 真实终端输入与输出曾通过；发现网页恢复失败后候选修复未复验 |
| WDH 测试与 CI | 25 项，Windows/Linux CI 已通过并随 PR #6 合并 |

旧日志、截图、构建与隔离应用目录均在被忽略的 `.tmp*` / `artifacts/`，不会随 Git 到 Mac。关键结果已写在此处。无需复制个人应用数据、模型密钥、抓包、浏览器 profile 或 node_modules 到 Mac。

## Windows 用户体验入口

最新 debug EXE：`X:\Project\github\DecryptHub-Desktop\.tmp\workspace-tabs-target\debug\jsra-tauri.exe`。启动器已将其列为候选，并按构建时间取最新；使用当前 sidecar 源码。

```powershell
powershell -ExecutionPolicy Bypass -File "X:\Project\github\DecryptHub-Desktop\scripts\start-desktop.ps1"
```

用户先自行关闭正在运行的 DecryptHub 窗口，避免同一数据目录多实例。体验数据在 `.tmp/desktop-appdata/WebDecryptHub`；该目录的 WDH 已从 0.1.0 校验并原子激活为 0.1.1，旧版本仍保留，IDH/ADH 和其它设置未改动。

另有最后一次**隔离验收窗口**：启动时 PID 136500，数据为 `.tmp/native-visual-GW9JAR/app`，本地测试模型，无真实模型配置；它不是日常体验目录。PID 可能变化或已退出，不能仅凭旧 PID 结束进程。忽略文件 `.tmp/native-visual-state.json` 和 `.tmp/native-tabs-visual.mjs` 仅供本机排查，不迁入产品。不要把该窗口中的假模型表现当作用户体验结果。

## Mac 支持结论和先行路线

**适合转到 Mac 继续源码开发；尚未验证可开箱运行或发布。** 当前已有 macOS 数据路径、Keychain 后端和 WDH 系统 Chrome/Edge 路径；终端非 Windows 使用 Bash。但这些不代表完整平台支持。

已核对的缺口：

- `src-tauri/src/main.rs` 的非 Windows 正式 sidecar 仍取 `jsra-sidecar-linux`；`build-sidecar.mjs` 仅 win/linux，`prepare-node.mjs` 只准备 Windows x64 Node。需独立 macOS 配置和运行时资源布局，不能给 Mac 使用 Linux/Windows 制品。
- Tauri bundle targets 目前是 appimage/nsis，没有 macOS app/dmg、签名、公证与更新资源；CI 没有 macOS runner。
- `embed_supported()` 在 macOS 返回 false；当前原生嵌入只有 Windows/X11，Windows layered 光晕不可移植。先使用 screencast 和宿主 DOM 光晕；不要为外观向目标网页注入代码。串流中文 IME、快捷键、剪贴板等仍需真实 Mac 验收。
- 官方 WDH 0.1.1 只有 win32-x64/linux-x64 下载项。开发先 `JSRA_DEV=1` + WDH 源码；后续在对应 Mac 架构上构建并发布组件。系统 Chrome 先验证，Cloak 的 Mac 内核另验，不假定其可用。
- node-pty 必须在 Mac 对应架构重新安装/编译，不复制 Windows 依赖。检查 Apple Silicon arm64 与 Intel x64。
- `scripts/check-ui.mjs` 的 Chrome 自动发现缺 Mac 路径，可先显式 `CHROME_PATH`；末段终端 UI 用例硬编码 `Write-Output`，需要按平台选择 Bash 命令。`check:desktop-browser` 是 Windows 专用，不在 Mac 运行或伪装通过。
- `sidecar/proctree.mjs`（WDH 也需核对）进程身份读取当前只实现 Windows/Linux；异常关闭、进程组和子进程清理需补 Mac 验证，不能全局按进程名杀。
- `scripts/preview.mjs` 只设 APPDATA，Mac 数据目录逻辑不使用它；若预览必须显式 `DECRYPTHUB_DATA_DIR` 隔离。此外它新建配置默认 `antiDebug:true`，不应直接沿用；优先用明确配置的源码桌面路径，或先修正预览隔离与默认值。

### Mac 候选启动步骤（未在 Mac 实测）

先准备 Node.js 24（CI 固定 24.16.0）、Rust/Cargo、Xcode Command Line Tools 和系统 Chrome。将两个源码仓库放相邻目录，例如 `DecryptHub-Desktop` / `WebDecryptHub-Runtime`。

```sh
git clone --branch codex/workspace-tabs-and-compact-menus https://github.com/decrypthub/DecryptHub.git DecryptHub-Desktop
git clone https://github.com/decrypthub/WebDecryptHub.git WebDecryptHub-Runtime
cd WebDecryptHub-Runtime
git checkout bc103f33c9b44b52e102de50fb1c3056718a1777
npm ci --ignore-scripts
cd ../DecryptHub-Desktop
npm ci --ignore-scripts
npm --prefix sidecar ci --ignore-scripts
npm --prefix sidecar rebuild node-pty
npm run build:ui
export JSRA_DEV=1
export DECRYPTHUB_WDH_DIR="$(cd ../WebDecryptHub-Runtime && pwd)"
export DECRYPTHUB_DATA_DIR="$(pwd)/.tmp/macos-dev/WebDecryptHub"
export JSRA_SIDECAR_NODE="$(pwd)/sidecar/index.mjs"
export JSRA_EMBED_MODE=screencast
export JSRA_KERNEL=system  # 已失效：桌面版内核固定 CloakBrowser，不再读取该变量
cargo run --manifest-path src-tauri/Cargo.toml
```

以上仅为本机 debug 源码入口。若依赖/编译/权限报错，保存具体诊断并修正式支持，不能声称已适配。首次打开需重新配置 Mac 本地模型和工作目录；不迁移 Windows 绝对路径绑定或浏览器配置。

### 下一位 Agent 的顺序

1. 检出工作分支并读本文，确认当前改动均在；不要只拉 main，也不要重复拆仓。
2. 在 Mac 查实际工具链/架构；先跑 sidecar 测试、UI build/audit、WDH 独立测试和集成；UI 检查先修平台假设及最新失败原因。
3. 真实 Mac 源码桌面验证菜单、多文件/Markdown、多个真实网页、请求视图、真实终端、会话与工作区切换/关闭。遵守用户不占用 Windows 桌面的要求。
4. 给候选 viewport 挂载修复补有意义的显示生命周期回归；Windows 原生恢复由用户体验反馈或后续空闲 Windows 验收确认，Mac 通过不能代替。
5. 平台适配和本轮功能分别保持可审查的提交；所有必需检查通过后创建/附加 PR，等待远端 CI，再合并。不要将此 WIP 检查点直接当通过版本。

工程约束继续有效：BrowserSurface 唯一显示所有者；控制/显示分离；会话/Run/工具稳定 ID；异步取消和过期检查；保留权限边界；cwd/环境过滤不是 OS 隔离；不提交凭据、浏览器数据、设备样本或第三方抓包。
