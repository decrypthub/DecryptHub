# 运行交互修正与复验 — 2026-11-04

本轮继续处理重启、模型配置、队列、滚动和文件交付反馈。基于 `handoff/ui-alignment-20261104` 的 `4c8f003701ce9b289030183ff03968b4a287222b`，保留开始时全部未提交改动；未提交、推送、发布线上版本。此前两轮记录保留历史含义，当前行为以本文为准。

## 反馈与实际修改

| 反馈 | 根因与处理 |
| --- | --- |
| 重启后上下文空白 | 历史快照只从运行中的 Agent 取统计。现在保存最近有效统计；冷态恢复按工作区、模型选择、容量核对，旧历史通过被动读取估算，不创建 Agent、不请求模型、不修复或重写历史。未知容量时不显示假的 0%。 |
| 内置记忆不能查看 | 系统记忆接口原来只返回来源元数据。现在返回产品与 ready 插件的实际正文，列表可以展开，保留只读标识，不提供编辑或额外权限。 |
| 模型配置太拥挤 | 新增渠道只选择 Chat Completions、Responses、Messages 三种格式；移除供应商品牌目录入口，格式改为下拉框，Base URL 独占整行。切换格式保留用户的自定义 URL，仅空值或官方默认地址随格式调整。旧渠道继续可读，未大规模删除兼容适配器。 |
| 思考强度中文 | 展示改为 Off / Minimal / Low / Medium / High / XHigh / Max；模型声明决定实际可选档位，协议 ID 不变。 |
| 不应让用户选择团队模式 | 移除用户模式开关和空的团队、子代理入口。根 Agent 创建第一个有效共享任务时建立团队；存在任务、子代理后才显示对应入口，成员可进入独立对话。 |
| 运行中不能插话、队列按钮拥挤 | 区分下一轮排队与本轮插话。Enter 和主发送按钮遵循运行参数中的同一策略，Cmd/Ctrl+Enter 取相反策略；空草稿时该快捷键可依次提交排队消息。队列改为独立原生按钮、行内编辑与保存/取消，避免嵌套点击和双击时的描边溢出。 |
| 长代码输出不跟随、上翻跳动 | 统一滚动控制器，观察内容和视口尺寸，显式区分跟随、用户阅读和待采样手势；修正阅读锚点偏移符号及物理底部定义。Markdown 改为稳定区块和代码行，流式尾部更新不再整体替换回复 DOM；定稿仍在同一带 key 的父节点中。 |
| 不知道 AI 实际改了哪些文件 | 使用文件工具已有的成功 ChangeStore 记录，在本轮最后回复后展示文件卡片、净增删行数，可进入右侧查看记录中的修改前/后；历史重开仍可查看，不根据回复中的文件名猜测。 |

主要新模块：`sidecar/context-inspection.mjs`、`queued-steering.mjs`、`turn-files.mjs`，以及 `ui/src/api-formats.js`、`submission-policy.js`、`markdown-blocks.jsx`、`turn-files.jsx`。Session、RPC 与 bus 负责接入，不把新的业务状态机全部堆入这些入口。

## 实读 DeepSeek Harness 源码

参考目录 `../deepseek-harness` 只读，HEAD 为 `8bd073392eef6f54e921a093b95076248eb08cbb`。下面记录实际阅读范围，而非声称整个相关包都已读完；部分较长文件只记录清晰读到的片段。

| 主题 | 路径及行范围，相对参考根目录 |
| --- | --- |
| 队列呈现与防重复 | `packages/client/ui-conversation/src/client/queue/QueueDock.tsx:1–415`、`QueueDock.module.css:1–248` |
| 提交策略 | `packages/client/ui-conversation/src/client/input/submission-policy.ts:1–86`、同目录 `hub.ts:242–287` |
| 插话投递边界 | `packages/api/session-controller/src/commands.ts:385–470`、`packages/core/agent/src/runtime-types.ts:250–261` |
| 跟随控制 | `packages/client/ui-chat/src/client/chat/use-scroll-follow.ts:1–182`、`use-chat-scroll.ts:1–187`、`use-chat-reading.ts:1–282` |
| 视口观察与手势 | 同目录 `use-chat-viewport.ts:1–195,535–620,740–777,930–956`；没有将约 970 行的完整文件声明为已读 |
| 上下文显示 | `packages/client/ui-conversation/src/client/skeleton/ContextMeter.tsx:1–180` |
| 团队模式 | `packages/client/ui-agent-team/src/client/TeamModeToggle.tsx:1–70`；任务板与任务状态机的其他阅读见上一轮记录 |
| 模型声明 | `packages/client/ui-settings-models/src/client/CustomProviderCard.tsx:1–150` 与 `ModelReasoningEfforts.tsx:1–110` 内的接口和档位处理；其后截断部分未计入完整阅读 |
| 交付文件 UI | `packages/client/ui-deliverables/src/client/ChangedFiles.tsx:1–177`，同目录 `Deliverables.tsx` 的交付状态与卡片组合部分 |
| 本轮文件归属 | 同目录 `turn-deliverables.ts:1–301` |
| 文件记录 | `packages/deliverables/workspace-changes/src/index.ts:1–145`、`capture.ts` 全文，以及 `recorder.ts:1–160,260–401` 中的记录、比较与回退处理 |
| 流式 Markdown | `packages/client/ui-primitives/src/markdown/MarkdownText.tsx:1–235`、`CodeBlock.tsx:1–85`，以及 `incremental.ts` 的前 180 行和尾部 update 控制流；没有将其中截断的中段声明为已读 |

参考实现的关键结构和约束：

- 队列来自 `InboxState['next-turn']`；pending submission 与正式行需要去重，操作由条目 ID 定位。只有 running 状态的 next-turn 条目可以 steer；不可编辑附件条目，not-found/unavailable 属于幂等收敛。空草稿批量插话按队列顺序处理。
- 阅读状态包含物理位置样本、跟随目标、用户手势和待提交样本。内容增长不能抢占尚未采样的阅读位置，scrollend 收敛阅读状态；到达物理底部恢复跟随。
- Markdown 按源偏移保留区块身份，冻结已经稳定的前部，仅重新解析尾部；代码行也有稳定身份。定稿时修复跨区块引用，不能因此丢失代码选区。
- 文件交付从实际成功操作和记录目标归属到 turn，去重保留首次出现顺序；读取、失败、参数损坏不构成交付，晚到工具结果仍可能更新归属。比较器对二进制、过大内容和复杂比较有明确回退。
- 上下文容量未知时隐藏用量；分项是上下文估计，不伪装成供应商最终计费。

## 本产品的数据与边界

### 队列与同轮插话

持久化队列行保留 `id`、完整 `text`、`attachments` 和可选 `delivery: 'steer'`。Host 校验根会话、工作区及当前 runId；切换后携带旧 runId 的点击拒绝，不移除原条目。Agent 在下一步边界领取，不中断正在执行的工具。

插话先提交历史用户事件，再确认移除队列；崩溃或重启按用户事件 ID 去重。停止发生在领取前时保留条目，等待手动继续。纯文本编辑不再拿 160 字预览覆盖全文。主问题仍是 turn 的第一个用户事件，插话按真实顺序进入同一 turn，不能覆盖原问题。最终回复到达时仍有待领取插话，则继续当前循环。

### 滚动与稳定内容

`scrollHeight - clientHeight` 是物理底部。锚点记录消息 ID 与相对视口偏移，恢复使用同一符号；手势先标记 pending，最长 500ms 采样，scrollend 提前收敛。内容和容器 ResizeObserver 与内容提交共用控制器，移除旧的短期多帧强制补偿。

Markdown token 使用源 offset key，前部冻结、尾部两块更新，代码行 memo 保持已完成行。流式和定稿消息保留同一 keyed flow 父节点，过程折叠使用 hidden 保留内容身份。解析必须继承 `marked.defaults` 中已配置的 renderer；直接传 `{async:false}` 曾绕过链接过滤，本轮已修复并加入逻辑检查。原始 HTML 与危险链接保持不可执行。

### 文件卡片与冷上下文

文件记录按 `workspaceId`、`runId`、规范化路径分组，取首次 before 与最后 after 比较，同文件重复修改显示净变化；失败、跨工作区、净变化为零不显示。删除文件布尔字段为 `removed`，行数使用 `added/deleted`，避免字段重名。二进制、过大或比较受限时不伪造精确计数。查看历史改动读取记录中的内容；查看当前文件走既有目录授权。异步结果与标签页归属校验工作区，晚到结果不写入另一个视图。

上下文样本保存 `workspaceId`、序列化的模型选择和统计，恢复时核对容量。旧数据走被动 History 视图，不持有写租约、不 spill、不修复目录；模型容量未知不显示假的计量。辅助统计保存失败不改变任务完成结果。

## 与参考仍有的差异

1. **编辑和状态基础设施**：保留现有 React、textarea、marked、Session/RPC，没有迁移 Lexical、mdast 或 Cordis。采用参考的稳定区块/尾部更新约束，但未移植其全部未闭合代码围栏、增量语法高亮及数学支持。逐行高亮在跨行语法上存在精度差异；跨模块整体迁移仍需独立评估。
2. **滚动动效**：实现即时跟随、阅读采样和真实尺寸观察，没有复制参考的整套折叠动效、虚拟空间与平滑目标动画。当前对话结构没有相同布局基础，盲目移植会引入两个位置所有者。很窄的聊天栏继续使用已有响应式精简，收起右侧工具面板可恢复完整用量控件。
3. **团队入口**：当前参考源中仍有模型菜单模式开关；用户这次明确要求由 Agent 决定，故按用户要求移除。首个有效根任务原子建立团队，成员不能绕过根先建任务。
4. **旧渠道**：新增配置只提供三种格式，旧渠道后台适配和凭据仍可读取，没有在本轮强制迁移或批量删除用户配置。
5. **文件覆盖范围**：使用现有文件工具 ChangeStore，不新增 Git 工作树前后快照，也不恢复已移除的 Git 页面。因此 shell、外部程序直接写文件尚不能保证被卡片列出。右侧提供记录前后对比，未复制参考全部统一 diff 和悬浮交互。记录仍受已有最近 100 项保留策略约束。
6. **子代理刷新**：沿用上一轮的被动历史查询及串行轮询，存在一个轮询周期的显示延迟；未改成参考的完整 projection/subscription。权限和父子链校验继续由 Host 执行。

这些是当前实现边界，不把“参考源码”表述为全部功能逐项等价。

## 检查结果与实际观察

本机证据目录 `.tmp/ui-runtime-followup-20261104/` 不入 Git。

| 检查 | 结果与证据 |
| --- | --- |
| UI 逻辑 | 81/81，`ui-tests-final.log` |
| 新增运行交互、团队、子代理和停止专项 | 18/18，`targeted-final.log` |
| 完整 sidecar 扫描 | 583 项：527 通过、44 失败、12 跳过，`sidecar-tests-final.log`。43 项与本轮开始前失败名单一致；额外一项已有终端时序测试单独复跑通过，见 `test-comparison-final.json`、`timing-recheck.log`。全量没有全绿。 |
| Markdown DOM 逻辑 | 实际 React DOM 检查流式追加和定稿后的 paragraph/pre/代码行身份、选区保留、原始 HTML 与危险链接，`markdown-check.log`；不使用像素/尺寸验收断言 |
| 编译与包 | UI build、UI audit、Bun runtime、Cargo release --locked 成功；包签名验证成功，见对应 `*-final.log`、`native-build.log`、`runtime-build.log`、`codesign.log` |
| 包内运行时 | 打包 sidecar 启动、独立历史校验器、真实 PTY 输入和关闭通过，`bundle-smoke.log` |

浏览器用独立 TaskSpace 10、独立数据与本机 HTTP 模型夹具实际操作，不访问用户模型端点。检查了三格式下拉、自定义 URL 保留、英文思考档位、只读系统记忆正文、队列编辑/双击/插话、流式到底与上翻阅读。截图包括 `api-formats.png`、`system-memory-readonly.png`、`queue-edit-selection.png`、`queue-steering.png`、`stream-following.png`、`stream-reading.png`，均查看过实际图片。阅读期间包含滚轮尾部惯性，不声称每一个采样点零像素变化。

随后从页面发送“团队验证”，由真实 Agent 工具创建两项共享任务和两个独立子代理；子代理实际执行本机 shell，入口在创建后出现，无需用户切换模式。进入子代理可见命令、退出码和 `SUBAGENT_TOOL_OK`，任务板显示真实成员和任务。图片 `team-auto-created.png`、`team-board.png` 已查看。夹具没有认领任务，任务显示待处理，不将模型文字“回收结果”当成任务完成。

**原生 release 另行验证**：复制同一发布二进制与包内 sidecar，仅更换 bundle ID、名称和数据路径形成 `DecryptHub 隔离验证.app`。在 macOS WebView 实际操作长代码输出、排队与插话、上翻阅读、回到底部、文件卡片及修改前/后查看。退出并冷启动后，原生界面恢复 `17.3k / 1M（2%）` 和 `quicksort.py +130 −0`，记录前后比较仍在。原生证据来自工具 AX 和可见截图观察，不伪造本地 PNG 文件名。未发现冷启动额外请求模型。

隔离验证窗口已退出，所建本机夹具渠道和仅供本轮使用的 `prov.local-fixture` 凭据已清理；浏览器 TaskSpace 已结束。用户原测试窗口未关闭、替换或重启。Ego Lite 提示有更新，本轮未升级。Windows 发布版、Mac 正式安装分发、公证和更新流程未在本轮验收。

## 交付入口

最新本机 release：

`.tmp/ui-runtime-followup-20261104/DecryptHub 交互修正测试.app`

版本仍为 1.5.0。UI 编译期嵌入原生 release，sidecar 使用包内固定 bundle，不读取当前源码或 HMR。构建时文件列表与 UI 哈希位于包内 `Contents/Resources/build-info.json`；签名后的外部清单为 `.tmp/ui-runtime-followup-20261104/artifact-manifest.json`。

该包沿用 `.tmp/macos-dev/WebDecryptHub` 测试数据目录，**先关闭旧测试窗口，再打开新包**。本轮没有替换仍在运行的 `.tmp/ui-seven-points-20261104/DecryptHub 界面对齐测试.app`。它仍依赖本机 Node 24 和已有 WDH 运行时，属于本机测试制品，不是可搬到任意 Mac 的正式安装包。
