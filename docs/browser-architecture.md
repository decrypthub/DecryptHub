# 桌面浏览器与会话元数据：架构决定

日期：2026-10-25。本文描述当前实现与后续边界，不能把待验收项当作已交付能力。

## 结论

界面里显示网页不代表采用相同的浏览器架构。当前为 Tauri UI + Node BrowserManager + 独立 Chromium 进程：Windows 用 `SetParent` 接管外部窗口，Linux X11 用 reparent；不支持或失败时用 CDP screencast 转发画面和输入。Agent 的 DOM、网络与调试操作通过 CDP/工具桥接，和画面呈现是不同通道。

不继续把窗口接管散落到业务代码，也不凭外观推断某个闭源产品的实现。现阶段保留可替换的独立内核，先建立并测试显示生命周期边界；原生组件路线需要独立原型和验收后再决定迁移，不能仅为“看起来更规范”同时改掉 UI 框架、浏览器、Harness 和历史格式。

## 三种路线的取舍

| 路线 | 实质 | 对本产品的影响 |
|---|---|---|
| 原生浏览器组件 | 例如 Electron `WebContentsView`，通过框架管理 view 与 WebContents | 窗口与内容生命周期有正式 API；Electron 升级决定其 Chromium 版本，不能把任意 Cloak EXE 当作 WebContentsView 的内核替换 |
| 独立 Chromium + 窗口接管（当前） | 启动真实浏览器，按 PID 找到窗口并改变父窗口及样式 | 能保留系统 Chrome、Cloak 和指定版本；需自行处理 DPI、焦点、IME、弹窗、遮挡和关闭恢复；不能当作跨平台原生浏览器组件 |
| 独立 Chromium + 画面流（当前回退） | 通过 CDP 接收帧并转发输入 | 控制和显示可解耦；输入法、无障碍、剪贴板、下载和流畅性需单独验收，不等价于原生浏览体验 |

官方依据：[Electron WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view)、[Windows SetParent 与 DPI 限制](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setparent)、[Tauri Webview API](https://v2.tauri.app/reference/javascript/api/namespacewebview/)。CEF/自有 Chromium 嵌入亦可评估，但会增加打包、安全更新和内核维护责任；本次未接入。

## 明确职责和唯一所有者

| 部分 | 负责 | 不负责 |
|---|---|---|
| Agent / ToolRouter / policy / Executor | 模型循环、工具授权、实际命令与任务状态 | 原生 HWND、布局矩形与标题生成 |
| BrowserManager（现有） | 浏览器进程、Profile、CDP 会话、页面与网络状态 | 根据 React 布局自行切换窗口、改变用户任务权限 |
| BrowserSurface（本次加入） | 串行显示/隐藏/释放、合并过期的显示请求 | 启动内核、执行网页脚本、判断 Agent 是否完成 |
| Rust embed adapter（现有） | Win32/X11 操作、窗口裁剪与原生资源释放 | 解释用户任务、持有模型密钥 |
| SessionTitleService（本次加入） | 根据首次用户任务生成展示标题 | 操作浏览器、调用工具、修改 Agent 历史或任务结果 |
| React 布局与状态（现有） | 计算位置、遮挡、显示任务状态 | 直接发出互相竞争的原生显示操作 |

当前 BrowserManager 仍同时包含进程、抓包与画面流逻辑，Session 仍承担多个域的编排。不能声称分层重构已经完成。后续在保持对外契约的前提下，优先将进程/配置文件租约、CDP 控制、捕获存储拆成可独立验证的模块，随后收窄 RPC handler 与前端 bus。

## 本轮实际加固

- 原生显示操作统一经过 BrowserSurface 队列。新请求使旧请求过期；已经开始的 native 操作完成后，后续 hide/show 才执行。快速切换不会让晚到的旧 show 越过 hide，新会话不会继承旧会话的 attach 错误。
- 显示失败不能破坏后续 hide/release；旧 React effect 的异步失败不再触发新会话的回退。
- 浏览器光晕位于原生网页矩形以外的宿主区域，串流与原生显示使用同一个内部视口。覆盖原生页面的浮层仍沿用 BrowserSurface 的隐藏/恢复机制，暂未实现冻结页预览。可见的 Windows 验收窗口使用 debug 专用的 `JSRA_DESKTOP_SMOKE=1` 与 `JSRA_DESKTOP_SMOKE_VISIBLE=1`，沿用独立数据目录中的 WebView profile，避免覆盖日常 UI 配置；生产构建不使用此分支。
- 标题先用任务文本给出即时名称，后台再请求当前模型概括。网页地址不能覆盖标题；手动命名以修订号和取消信号阻止晚到的结果覆盖。
- 标题请求不带工具，只提交首次任务的有限文本；最多同时两项、单项 12 秒、输出最多 256 tokens。关闭会话取消请求，排队中取消不会请求模型；失败保留任务名称，不重试用户任务。标题属于额外的元数据请求，不计入 Agent Run 的 usage。
- DeepSeek V4 的标题请求按官方协议关闭 thinking，避免推理耗尽短输出预算；用户任务的 thinking 设置不受影响。参考 [DeepSeek Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/)。
- `titleSource` 随会话持久化；旧编号标题可从首条用户历史补全，已有自定义标题保留。会话 ID 与标题独立，改名不影响排查。

## 后续开发与发布门槛

新增内核或显示后端之前必须明确 capability（导航/输入/抓包/调试/下载/原生显示），不能靠名称假定全部支持。继续保留统一的浏览器工具面，Agent 不应依赖 PID、HWND 或具体 UI 框架。

协议和存储变更需要迁移策略；生命周期变更需要关闭、取消、切换与晚到结果测试；权限变更需要标准、只读和完全访问三种模式回归。新功能优先写在所属模块，不能继续向 RPC 表、Session 和前端 bus 堆业务实现。

现有 CI 会运行本次的显示竞态和标题生命周期测试，但主要为 Linux；Windows 真实 UI 的发布矩阵仍未自动覆盖。发布前需在声明支持的系统/内核组合中验收：100/125/150/200% DPI 与跨屏、中文 IME、焦点和快捷键、登录/新窗口、原生对话框、下载与文件选择、遮挡/最小化、浏览器崩溃与重启、会话快速切换。mock 竞态测试不能替代这些原生验收。
