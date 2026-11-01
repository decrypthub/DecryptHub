# macOS 源码开发

2026-10-29 补充：项目先建立、会话后创建；没有项目时为零会话，已移除无项目记录的兼容导入，详见 [项目导航](project-navigation.md)。Mac 浏览器使用不弹外部窗口的画面串流；Windows/X11 保留原生嵌入策略。当前核心回归为 242 项：239 通过、3 项 Windows 专用跳过；Rust 9 项通过。UI 回归需显式设置 `DECRYPTHUB_WDH_DIR=/Users/r/Developer/DecryptHub/agent/WebDecryptHub-Runtime`，使用本地已安装组件，避免把 GitHub 下载限流当成产品回归故障。

2026-10-28。接续 `handoff-macos-2026-10-28.md` 中的检查点 `cfa3417`；保留该文档中的 Windows 待验收事项，不将 Mac 结果当作 Windows 原生窗口恢复证据。

## 使用本地副本

源码和依赖放在 Mac 本地文件系统。挂载的 SMB 共享适合读取交接资料，不要在 Windows 正在使用的 checkout 中安装 Mac 的 node_modules 或原生依赖。首次在共享盘执行 npm ci 时出现 EIO，已停止并改用独立本地 clone；共享盘对应的忽略目录 node_modules 可能已被部分替换，Windows 下再次构建前应在该机器重新执行 npm ci。没有重置、清理旧融合仓库或改写其源码。

当前本地目录为 `/Users/r/Developer/DecryptHub/agent/DecryptHub-Desktop`，WDH 位于同级的 `/Users/r/Developer/DecryptHub/agent/WebDecryptHub-Runtime`（2026-10-29 从 `/Users/r/Developer/` 根下整体迁入，原路径已不存在）。桌面使用 `codex/workspace-tabs-and-compact-menus` 分支，WDH 使用 `bc103f33c9b44b52e102de50fb1c3056718a1777`。后续可换目录，但不要复用 Windows 的依赖、浏览器 Profile 或应用数据。

## 准备

需要 Node.js 24（本次为 24.16.0）、Rust stable、Xcode Command Line Tools，以及 WDH 的 CloakBrowser 内核。桌面版已固定只使用 CloakBrowser：不再读取 `JSRA_KERNEL`，系统 Chrome/Edge 只在 WDH 单独作为 MCP/CLI 使用时可用。两个仓库都需要按各自约定安装依赖。

使用 nvm 时，先执行 `nvm use 24.16.0`；本次仅安装了该版本，未更改用户默认 Node 版本。

```sh
cd ../WebDecryptHub-Runtime
npm ci --ignore-scripts
cd ../DecryptHub-Desktop
npm ci --ignore-scripts
npm --prefix sidecar ci --ignore-scripts
npm_config_build_from_source=true npm --prefix sidecar rebuild node-pty
npm run build:ui
```

node-pty 1.1.0 的 Mac arm64 预编译 spawn-helper 在本次安装后没有执行位。普通 rebuild 仍选择该预编译目录，真实终端报 `posix_spawnp failed`；强制源码重建后，真实输入、多个终端隔离及关闭测试通过。不要修改整个工作区权限，也不要复制其他平台的二进制。npm 11 会对 build-from-source 环境选项给出未来兼容性警告，目前仍会传递给 node-pty 的安装脚本。

## 源码启动

2026-10-29 账号登录验收补记：实迁后还需检查 `.tmp/macos-dev/DecryptHub.app/Contents/Info.plist` 的 `LSEnvironment`；sidecar、WDH 和数据目录已改为 `agent/` 下的新路径，应用已从新路径重新编译并验签。路径或 ad-hoc 签名二进制变化可能使 macOS 再次要求钥匙串授权，必须由用户处理；不能以旧路径进程仍存在作为新版本已启动的证据。

从桌面仓库根目录运行，确保 PATH 中的 node 是 24：

```sh
export JSRA_DEV=1
export DECRYPTHUB_WDH_DIR="$(cd ../WebDecryptHub-Runtime && pwd)"
export DECRYPTHUB_DATA_DIR="$(pwd)/.tmp/macos-dev/WebDecryptHub"
export JSRA_SIDECAR_NODE="$(pwd)/sidecar/index.mjs"
export JSRA_EMBED_MODE=screencast
export CARGO_TARGET_DIR="$HOME/Library/Caches/DecryptHub/macos-target"
cargo run --manifest-path src-tauri/Cargo.toml
```

首次打开浏览器前，在插件页的 WDH 内核区下载 CloakBrowser：macOS arm64 会用官方最后一个公开 darwin 构建（`chromium-v145.0.7632.109.2`，Apple Silicon）；官方新版本只发布 Linux/Windows 包时，WDH 会自动回退到含当前平台文件的 Release。

此入口使用独立开发数据目录，不迁移 Windows 绝对路径或用户模型密钥。首次打开需自行配置模型和工作目录。不要使用尚未修正隔离目录逻辑的 `scripts/preview.mjs` 代替此入口。

## 检查

从桌面仓库根目录执行：

```sh
export JSRA_DEV=1
export DECRYPTHUB_WDH_DIR="$(cd ../WebDecryptHub-Runtime && pwd)"
node --test sidecar/test/*.test.mjs
npm run build:ui
npm run audit:ui
npm run check:wdh -- ../WebDecryptHub-Runtime
npm run check:ui
cargo test --manifest-path src-tauri/Cargo.toml
npm --prefix ../WebDecryptHub-Runtime test
```

UI 脚本可自动发现系统或用户 Applications 目录下的 Chrome/Edge，也可显式指定 CHROME_PATH。终端 UI 检查在 Windows 使用 PowerShell，在 Mac/Linux 使用 printf。浏览器视图回归会等待网络页卸载画布，再检查返回网页后的新画布收到非透明像素；它只验证串流恢复，不验证 Windows 嵌入窗口。

在 macOS 15.6.1 / Apple Silicon arm64 的验证结果：

- 桌面 sidecar：新增画面缓存及侧栏偏好测试后共 235 项，232 通过、3 项 Windows 专用跳过，无失败；包含真实 PTY。
- WDH：25 项，22 通过、3 项 Windows 专用跳过，无失败；独立 MCP/DOM/抓包/调试联调通过。
- UI 构建、audit 和增强后的深浅主题完整回归通过，包含网页 → 网络请求 → 网页的非透明像素断言；两种主题的 browser-restored 截图均已生成。
- Rust cargo check、cargo build 和 9 项单元测试通过；存在既有未使用函数警告。
- 真实 Mac Tauri debug 宿主已在独立临时目录启动，私有 endpoint 的 session-list/doctor RPC、系统 Chrome 检测及后端退出请求通过；验证结束后仅终止本次创建的进程组。该隐藏窗口冒烟没有验收可见交互或输入法。

本地日志在被忽略的 `.tmp-macos-*.log`，UI 截图在 `artifacts/ui/`。不得提交包含启动票据的 dev-endpoint.json 或个人应用数据。

## UI 热更新开发

2026-10-30 已在真实 Mac Tauri 窗口验证：复用 `.tmp/macos-dev/DecryptHub.app` 中原有 debug 二进制，通过现有 `JSRA_UI_DEV_URL` 入口加载 Vite。UI 修改即时生效，本次没有重新编译、重新签名或再次触发钥匙串授权。侧栏按钮间距、项目无箭头折叠与会话空图标位已通过该入口检查。

先在仓库根目录启动 Vite（使用 Node 24），保持它运行：

```sh
npm run dev:ui -- --host 127.0.0.1 --port 5173 --strictPort
```

手动退出空闲的 DecryptHub 窗口，再在另一个终端从仓库根目录启动已有开发宿主；沿用开发包登记的 sidecar / 数据 / WDH 环境，仅为本次进程增加 UI 来源：

```sh
/usr/bin/python3 - <<'PY'
import os, plistlib
from pathlib import Path
app = Path('.tmp/macos-dev/DecryptHub.app').resolve()
with (app / 'Contents/Info.plist').open('rb') as stream:
    metadata = plistlib.load(stream)
environment = os.environ.copy()
environment.update(metadata.get('LSEnvironment', {}))
environment['JSRA_UI_DEV_URL'] = 'http://127.0.0.1:5173'
binary = str(app / 'Contents/MacOS/DecryptHub')
os.execve(binary, [binary], environment)
PY
```

这只改变开发进程的启动环境，不修改 `.app`。通过 Finder 直接打开 `.app` 仍加载上一次编译进原生二进制的 UI；开发验收应使用上述入口。需要检查打包资源、原生代码或发版时，仍须正常重新构建、签名与验收。

## 尚未完成

2026-10-30 开发授权提示说明：当前临时 `.app` 使用 `codesign --sign -`，`codesign -d -r-` 确认 designated requirement 仅为 `cdhash`。每次把编译后的 UI 嵌入 Rust 并重新签名，构建哈希变化，已有钥匙串授权可能再次触发确认。这与用户是否已经输入过密码不同；不要把系统密码保存到脚本、聊天或配置，也不要扩大钥匙串 ACL、关闭验证或迁出凭据来消除提示。

纯 UI 开发应优先使用现有 debug 专用 `JSRA_UI_DEV_URL=http://127.0.0.1:5173` 和 Vite 热更新，复用原生二进制；只在原生代码或原生验收需要时重建。原生持续迭代应使用固定签名身份与稳定 bundle identifier；切换签名后的首次授权仍须用户处理，跨更新是否保持授权需要单独验收。本轮只检查可用身份，没有使用任何现有证书私钥、修改其信任或重新签名当前应用。依据：[Apple TN2206：Designated Requirement 与 Keychain](https://developer.apple.com/library/archive/technotes/tn2206/)。

- Intel x64 和其他 macOS 版本尚未验证。
- 没有正式 Mac 安装包、生产 sidecar 资源布局、签名、公证或更新包；原生浏览器嵌入不支持 Mac。本地 `.tmp/macos-dev/DecryptHub.app` 仅包装本次 debug 二进制，运行时仍需上述源码开发环境，不是可分发制品。
- 仍需真实 Mac 桌面验收串流中文 IME、快捷键、剪贴板、会话/工作区切换和异常退出清理；现有进程身份读取缺 Mac 实现，不能声称完整清理链路已适配。
- Windows 网页 → 网络请求 → 网页的原生窗口恢复仍需 Windows 单独复验。
- 交接中“测试内核”按钮超时（现按钮为“测试 CloakBrowser”）在本次显式设置有效 WDH 源码目录后未复现。这不证明旧 Windows 失败的根因；检查时需同时核对组件安装/启用状态与源码开发环境。

## 本轮发现的串流恢复缺口

旧 UI 回归会在返回网页后直接打开浏览器菜单，不能证明实际画面已恢复。增加非透明画布断言后，在 dark 主题稳定复现返回网页黑屏：canvas 已重新挂载，但静止页面不再产生新帧，旧绘制函数在没有 canvas 时直接丢弃帧，也没有在重新挂载时恢复画面。

本轮新增独立 `BrowserFrames` 模块，仅保留当前目标最新一帧并在 canvas 挂载时重绘。缓存随会话/页面 ID/URL/浏览器进程切换而清除；解码修订防止旧图像写入新 canvas。新增测试覆盖静止帧恢复、隐藏期间最新帧、乱序/晚到解码和目标切换清理。此串流问题与 Windows 原生窗口恢复不是同一个已证实根因。

## Mac 原生窗口栏

Mac debug 宿主现已启用系统装饰，左上角关闭、最小化、全屏/缩放按钮由 AppKit 提供；不在 HTML 中仿制红黄绿。原生初始化能力 `__JSRA_NATIVE_TITLEBAR` 同时控制前端删除右上角重复窗口按钮及缩减空白，工具面板开关保留。Windows/Linux 仍走原来的无边框配置，未操作 Windows 桌面。

本次在保留开发数据的情况下重启窗口，原生可访问性树确认了 close/full screen/minimize 三种系统按钮，右上角只保留工具面板开关。之后按 Harness 风格改为 overlay 标题栏，去掉独立系统标题行；真实 Mac 已验证侧栏折叠/恢复与关闭后重新启动，项目绑定和会话保留。深浅主题 UI 回归分别检查原生与自定义布局，核心 232 项通过、3 项平台专用跳过，Rust 9 项测试及构建通过。全屏空间切换与 Windows 原生交互仍需人工进一步验收。

本地调试 `.app` 的 Info.plist 带固定源码开发环境（LSEnvironment），确保通过 Finder 或原生 UI 工具重新打开时仍使用同一个 Mac 开发数据目录、Node 24 和 WDH 源码。它不包含凭据，不是可独立分发的正式安装包；移动源码或运行时后需重新准备该入口。
