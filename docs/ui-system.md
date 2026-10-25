# UI 设计系统

WebDecryptHub 是面向 JS 逆向分析的桌面工作台。界面以番茄红为唯一品牌强调色，在浅色和深色模式下保持一致的信息层级。

## 实现边界

- React + Radix Themes 提供基础控件，Sonner 提供通知；保留 Tauri、WebSocket 和 sidecar 的业务接口。
- `ui/src/theme.js` 统一应用和独立弹窗的 Radix 主题配置。浅深色由 Radix 切换，`app.css` 只把语义色映射到 Radix 色阶，并保留品牌红配置。
- `ui/src/kit.jsx` 提供共享图标、Markdown、空状态、选择器和对话框。图标统一来自 `@radix-ui/react-icons`，使用明确导入以便裁剪。
- 字体优先使用系统 Segoe UI Variable / 微软雅黑 UI；代码使用 Cascadia Code / Consolas。没有远程字体依赖。

## 桌面结构

- `shell.jsx`：原生窗口标题栏、会话列表、快捷搜索、可调整宽度的主工作区、首次运行引导。
- `chat.jsx`：会话身份、上下文用量、分析首页、消息和工具记录、模型与权限选择、附件和输入区。
- `dock.jsx`：浏览器、网络请求、请求详情、脚本、文件和分析报告。
- `screens.jsx`：设置、自动化任务、MCP 服务。全局会话导航始终保留。

默认聊天优先：左侧会话栏与右侧工具面板都收起（状态分别写入 `wdh_rail` / `wdh_side`），窗口里只保留中间的对话区；展开后侧栏 236px，主区与工具面板使用 `react-resizable-panels`，宽度写入 `wdh-workbench-layout`。最小桌面窗口为 1080 × 680；布局同时验证 1280 × 800 与 1440 × 900。

## 颜色和尺寸

品牌色保留 `#e54d2e`。正文和交互均使用语义变量，例如 `--ink`、`--muted`、`--surface`、`--inset`、`--line`。小号白字的实心主按钮使用同色系 `#cc4329`，满足文字对比度要求。语义状态绿、黄、红只用于运行状态和反馈。

标题栏 46px，工作区标题 63px。控件直接使用 Radix 的尺寸与变体，不覆盖组件内部类：

- 常规按钮、图标按钮、模型和模式选择器统一 `size="2"`，高 32px；文字采用库默认 14px，独立操作图标为 18px。
- `Button` / `ActionIcon` 分别组合 Radix Button、IconButton 和 Tooltip。普通次要操作静止时透明，悬停、按下、展开或选中时显示组件库底色；不改变尺寸、边框、圆角和焦点状态。
- `NavButton` 固定使用 Radix Button 的 soft 变体，仅切换选中色，保证点击前后的图标、文字和内边距不变。导航行高至少 40px、行间距 8px，未选中时保持透明，悬停和焦点状态沿用库样式。
- 操作组间距 8px；标签内部的移除按钮使用库的 `size="1"`（24px），图标 14px。
- 输入区使用 Card + TextArea + Select；工具和请求详情使用 Tabs；主题选择使用 RadioCards；上下文用量使用 Popover。

应用外壳采用 11px 圆角，输入区 12px，列表与导航 7px。紧凑字用于工具元信息，正文保持 12–13px，页面标题 27px。

## 交互和可访问性

- Ctrl+K 只搜索会话，支持名称或网址；方向键选择，Enter 打开，Esc 关闭。
- Ctrl+T 新建会话；Ctrl+L 聚焦地址栏；Ctrl+, 打开设置。
- Ctrl+Alt+1 聚焦分析区，2/3/4 切换浏览器、请求和产出。
- 工具页签支持左右方向键、Home、End，具有 tab / tabpanel 语义。
- 所有图标操作提供可访问名称、悬停和键盘焦点状态；会话行仅保留一个“更多”入口，在菜单内重命名或关闭，也支持双击重命名。
- 菜单、页签和浮层的焦点、方向键、Esc、点击外部关闭由 Radix 管理；业务会话搜索保留结果导航。动效遵守 `prefers-reduced-motion`。
- 通知统一使用 Sonner 自带样式，在窗口顶部中央显示，距离顶部 60px，并跟随浅深主题。展示、队列、悬停暂停、自动关闭和手动关闭由库管理；不使用 Callout 拼接通知或编写通知外观 CSS。
- 空状态说明下一步操作，不展示虚构请求、计数或分析成果。
- 对话以内容为主：用户消息使用轻底色，助手用图标区分身份，复制入口在悬停或键盘聚焦时出现。
- 连续工具调用默认合并收起，输入、输出和耗时放入详情；未修改的默认任务模板不显示进度条。
- 会话列表只显示标题、时间与真实运行状态；搜索入口放在列表标题旁，也支持 Ctrl+K，只列出会话。标题栏不放搜索入口。正常连接不显示状态，重连时在标题栏内提示；快捷键保留在对应按钮提示中。

## 验证

1. `npm run build:ui` 构建前端。
2. `npm run check:ui` 使用隔离数据目录和真实 sidecar，检查浅深主题、按钮尺寸与命中区域、模型/模式菜单、会话操作菜单与创建/重命名/搜索、全部设置页、面板调整、自动化表单、本地浏览器抓包和响应、最小窗口，以及保存的示例会话。
3. `npm run audit:ui` 禁止覆盖 Radix 基础控件内部类、禁止重复定义组件尺寸体系，同时检查列表点击区域。
4. 人工复查 `artifacts/ui/` 的浅色与深色截图；示例对话明确标注为 UI 验证数据。

本地预览：`node scripts/preview.mjs --port 5333 --appdata .tmp/ui-redesign-preview`。预览使用独立数据目录，不覆盖已安装应用的数据。

本地桌面体验：先构建 UI 和 Rust，再运行 `powershell -File scripts/start-desktop.ps1`。启动器使用真实 Tauri 窗口和当前 Node sidecar 源码。体验数据位于 `.tmp/desktop-appdata`，开发版 WebView2 缓存位于 `.tmp/desktop-webview`，不安装或覆盖已安装版本。

调试模式（Tauri dev 等价，无需安装 Tauri CLI）：先用 `scripts\build-desktop.cmd` 构建一次 Rust（本机需要 vcvars64 + clang-cl），再运行 `npm run dev:desktop`。前端由 Vite 在 `http://127.0.0.1:5173` 提供，改 UI 即时热更新、不用重新构建；改 Rust 需重新执行 `scripts\build-desktop.cmd` 并重启。F12 / Ctrl+Shift+I 打开 WebView2 DevTools。实现上由 `JSRA_UI_DEV_URL`（仅 debug 构建生效）把窗口指向 dev server，`capabilities/default.json` 的 `remote.urls` 与 `permissions/app.toml` 负责放行该来源的 IPC。
