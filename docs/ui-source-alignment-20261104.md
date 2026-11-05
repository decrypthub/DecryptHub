# UI 源码对齐记录 — 2026-11-04

基于交接分支 `handoff/ui-alignment-20261104` 的 `4c8f003` 继续开发。本轮直接克隆并阅读官方源码后修改实现；交接文档仅用于确定待办，不作为参考实现。

## 参考源码与实读范围

官方仓库：`https://github.com/deepseek-ai/deepseek-harness.git`。

本机只读工作树：`../deepseek-harness`，完整提交 `8bd073392eef6f54e921a093b95076248eb08cbb`。这是本轮克隆时的远端 HEAD，与上一轮 `ce7073d512` 分开记录；参考工作树无修改。

以下路径均相对于该参考工作树：

| 文件 | 实读行号 | 使用的约束 |
| --- | --- | --- |
| `packages/client/ui-conversation/src/client/input/submission-policy.ts` | 1–86 | 忙时默认 queue，Enter 与主按钮同一策略，Ctrl/Cmd 选择相反投递；真正的投递窗口由 Host/Agent 决定 |
| `packages/client/ui-conversation/src/submission-settings.ts` | 全文件 | `busyEnter: 'queue' \| 'steer'`，默认 queue |
| `packages/client/ui-conversation/src/client/skeleton/InputBar.tsx` | 1–330、330–402 | 空草稿时停止，有草稿时按提交策略发送；上传与发送阶段分别守门 |
| `packages/client/ui-conversation/src/client/input/editor/keymap.ts` | 全文件 | 输入法、菜单、重复按键与修饰键先于提交仲裁 |
| `packages/client/ui-conversation/src/client/stop-shortcut.ts` | 1–65 | 会话、轮次、区域、审批、终端与焦点边界 |
| `packages/client/ui-conversation/src/client/stop-sequence.ts` | 1–52 | 500ms 内独立两次按键；首次按键有有效期；接受停止前清空序列 |
| `packages/client/shortcuts/src/client/dom.ts` | 1–116 | 本地控件先处理；被消费或停止冒泡的按键不能接续；焦点、指针、输入法、窗口失焦与弹层变化重置 |
| `packages/client/ui-conversation/src/client/service.ts` | 548–566 | scoped cancel 保留 Queue，失败反馈到界面 |
| `packages/client/ui-tool/src/client/tool/models/tool-call-model.ts` | 1–347 | 工具行纯投影；普通错误保留首条结果原因；中断与错误分开；正文延迟格式化 |
| `packages/client/ui-tool/src/client/tool/models/terminal-card-model.ts` | 1–360 | shell/terminal-send 分型，明确退出码与信号，持久 shell、溢出及畸形回执回退通用呈现 |
| `packages/client/ui-tool/src/client/tool/components/ToolRow.tsx` | 1–420 | 输入/输出卡片、折叠行的错误原因、停止状态与退出码提示 |
| `packages/client/ui-tool/src/client/tool/components/ToolRow.module.css` | 1–345 | body 是普通列；IN/OUT 各自滚动；终端仅输出区滚动 |
| `packages/client/ui-chat/src/client/chat/use-chat-reading.ts` | 1–283 | 跟随意图显式归属阅读控制器，暂停跟随与恢复贴底分开 |

核心数据结构：

- `StopTarget`：`sessionId`、`turn: number`、`generation: object`、`region: Element`、`cancel()`；序列保存 `{ target, deadline }`。
- `ToolRowModel`：`variant`、`titleKey`、`summary`、`filePath`、`bodyRaw`、`output`、`errorSummary`、`autoReviewDenial`、`state`。状态区分 `preparing/running/ok/error/stopped`。
- `TerminalCardModel`：`card` 保存 `cwd/output/exitCode/signal/running/background`；`copy` 是 `shell` 与 `terminal-send` 的判别联合，显示文案不改变工具回执。
- `ChatReadingState`：`initialized`、`followingTail`、`activeTurn`；阅读控制器持有采样任务，视口层负责 DOM 几何。

## 已修改

1. 新增 `ui/src/stop-shortcut.js`，在本地控件处理后仲裁双 Escape。只有当前连接中的主会话、同一轮次、同一区域可组成序列；菜单、对话框、审批/回答等待、终端、输入法、重复键、组合键、焦点/指针变化都会重置。组件卸载或会话/运行状态变化会释放监听与定时器。
2. 新增 `agent-cancel-turn` RPC，显式传会话和运行 ID；后端拒绝已过期轮次。停止按钮、双 Escape 与运行中的 `/stop` 走同一取消入口，保留队列且不自动启动下一条。已有生命周期整体中断仍保持原行为。
3. 工具输入/输出用一个卡片、两个独立滚动区呈现，标签留在各自区域。工具 body 与过程列表不再增加滚动容器。普通失败在折叠行显示首条原因，明确退出码继续保留命令摘要；已停止使用独立文字和提示色。
4. `ChatScroll.pauseFollowing()` 仍由已有滚动控制器独占视口状态。手动展开/收起执行过程、工具或思考前先释放贴底，避免长卡片开头被新高度顶走；后续显式回到底部可恢复跟随。没有新增另一处 `scrollTop` 写入。

## 保留的差异与原因

- DecryptHub 使用现有 React textarea、Radix、Session 与 RPC，不为快捷键引入 DSH 的 Cordis/Lexical 服务树。DSH 的 binding generation 在这里由组件生命周期、会话 ID、唯一 run ID 和实际 DOM region 共同约束；后端再次检查 run ID。
- 参考默认忙时 Enter 为 queue，目前继续保持 queue。**busy-Enter 偏好、Ctrl/Cmd 互换 queue/steer 仍未实现**：主会话目前只有入队契约，不能只添加 UI 选项却没有真实投递窗口、附件与历史语义。
- 原生审批、WDH、子代理管理仍归现有所有者。双 Escape 不接管终端或审批区域，独立子代理入口不冒充主会话停止序列。
- 工具回执使用本项目实际的 shell 字符串与 terminal JSON。未取得退出标记、等待超时、持久 shell 与畸形结果不推断成退出码 0；保留原始输出供复制和恢复。这与 DSH 的回执形状不同，不能直接套它的解析器。
- 卡片保留既有 220px 阅读上限，适配当前字体和复制按钮；采用源码中的独立滚动结构，没有宣称逐像素复制。此次也没有迁移 DSH 的整套折叠动画与视口补偿器。

## 验证与边界

- 定向测试 16/16：快捷键仲裁、轮次过期、停止后队列不丢失/不自动执行、手动继续、取消回执写盘恢复、错误摘要与终端状态。另有展开阅读释放贴底专项通过。
- `npm run build:ui`、`npm run audit:ui` 通过。
- 后端全量：566 项，511 通过、43 失败、12 跳过。使用 `git archive 4c8f003` 的独立源码与同一套锁定依赖对照：565 项，510 通过、43 失败、12 跳过；失败名称一致。
- UI 全量：74 项，71 通过、3 失败；交接提交对照为 65 项，62 通过、3 失败。三项仍是原有 `chat-scroll.test.mjs` 把 `scrollTop` 期望成 `scrollHeight` 的贴底断言；没有改写这些断言来刷绿。
- 使用 `ego-browser` 查看构建后的静态前端、真实 sidecar 和隔离的本机 HTTP 模型夹具。已实际执行 shell 长输出，观察到输入/输出分别可滚动、工具 body 与过程列表 `overflow: visible`；修正后再次截图，展开卡片保留开头及阅读位置。恢复复验后实际滚动输出，输入位置保持不变；点击复制输出显示成功。
- **本机浏览器可见复验已完成。** 真实 `sleep 90` 命令运行中，补充消息经主按钮入队；单次 Escape 后工具仍运行，连续两次 Escape 后工具行与轮次都显示“已停止”，不计失败，命令进程已退出。队列保留且未自动执行；刷新后停止状态与队列仍在，点击“立即发送”才执行补充消息。
- 停止按钮与运行中的 `/stop` 分别实际停止另一条长命令。真实 `exit 7` 保留命令摘要，工具行显示“退出码 7”，轮次显示“失败 1”；与取消状态明确区分。切换到另一个测试会话再切回后，6 轮记录、3 条取消工具及唯一的真实失败保持正确。
- 检查了 580×640 窄视口：侧栏可收起，工具命令省略而“已停止”状态完整保留，输入区操作可用。截图与可访问树均已保存；不是像素断言脚本。
- 上述结果仅覆盖本机浏览器中的构建前端与真实 sidecar/shell。Windows 发布版的两项最终复验继续待验收，本机也没有完成 Mac 原生发布包验收。

本机证据在 `.tmp/ui-source-alignment-20261104/`：`targeted-final.log`、`disclosure-final.log`、`sidecar-final.log`、`baseline-tests.log`、`ui-final.log`、`baseline-ui-tests.log`、`audit-final.log`、`long-io-final.png`、`stop-and-queue.png/txt`、`stop-restored.png/txt`、`failure-exit7.png/txt`、`narrow-stopped.png/txt`。数据、模型夹具与截图都不进入 Git。浏览器复验空间与临时服务已关闭。未修改用户安装、凭据或个人会话数据，未推送或发布。
