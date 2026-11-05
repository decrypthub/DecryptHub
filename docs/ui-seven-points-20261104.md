# 七项界面对齐记录 — 2026-11-04

这是上一轮历史记录。后续用户明确取消用户团队模式开关、隐藏空入口，并反馈冷重启、队列和滚动问题；当前行为、测试及最新 release 入口以 [运行交互修正与复验](ui-runtime-followup-20261104.md) 为准。下文保留上一版实现与验收事实。

本轮针对用户提供的七张截图修改，基于 `handoff/ui-alignment-20261104` 的 `4c8f003701ce9b289030183ff03968b4a287222b`，保留开始时的未提交改动。没有提交、推送或创建线上 Release。此前的停止路由、队列和工具卡片修正见 [源码对齐记录](ui-source-alignment-20261104.md)。

## 七项反馈对应结果

| 反馈 | 当前实现 |
| --- | --- |
| 分支按钮应是图标 | 回复操作区使用分支图标，保留「从此处分支」提示和原有分支协议。 |
| 压缩 UI 重复，输入框上方的组件多余 | 移除输入坞上方的大命令状态条。运行中在对话尾部显示单行，完成后与持久化压缩记录合并；输入在接受命令后清空，后续新草稿不被清除。运行中状态变化也触发阅读位置控制器。 |
| 命令没有变色，难以判断执行状态 | 已识别的开头命令高亮，参数保持普通文字；命令运行、完成、失败在对话流反馈。技能名来自实际 `extensions-list`，不是固定展示用名单。 |
| 文件查看器不一致，暂时去掉 Git 改动 | 文件页显示实际根路径，可复制、刷新；移除 Git 页签和 UI 请求，未打开文件时目录填满面板。已有文件打开和授权边界保留。 |
| 子代理功能和团队入口不明显 | 原有子代理执行能力保留，顶部零状态也可发现、创建。新增可开关的智能体团队和真实共享任务板，成员及任务来自 Host。 |
| 命令菜单与参考不同 | 按添加、指令、技能等分组，显示图标、中文名、英文命令、描述；菜单与输入框同宽，键盘选择、鼠标选择和补全一致。异步技能目录到达时按命令名保持选择。 |
| 子代理可进入 | 从顶部列表、团队成员和轮次入口进入独立对话；显示用户消息、思考、工具过程、回复、压缩及更早历史。可以补充要求、继续、单独停止，并返回主对话。主对话草稿保留。 |

主要前端文件为 `chat.jsx`、`harness.jsx`、`command-input.jsx`、`files.jsx`、`subagents.jsx`、`subagent-conversation.jsx` 和 `team.jsx`。共享任务逻辑独立放在 `sidecar/agent-team.mjs`，子代理查询边界放在 `sidecar/subagent-inspection.mjs`；RPC 只适配协议，不承载整个任务板状态机。

## 参考实现实读

参考仓只读，HEAD 为 `8bd073392eef6f54e921a093b95076248eb08cbb`。下列路径均相对于 `../deepseek-harness/`；本轮读取实际实现后修改，没有复制产品标识或整段源码。

| 主题 | 实读文件与行范围 |
| --- | --- |
| 消息分支操作 | `packages/client/ui-chat/src/client/chat/MessageIconActions.tsx:1–90` |
| 压缩与命令状态 | 同目录 `CompactionItem.tsx:1–76`、`CompactionCommandCard.tsx:1–26`、`GenericCommandCard.tsx:1–75` |
| 命令识别、选择与编辑 | `packages/client/ui-conversation/src/client/input/editor/CommandChip.tsx:1–28`、`command-chip-selection.ts:1–110`、`command-chip-node.tsx:1–157` |
| 命令菜单 | `packages/client/ui-input-trigger/src/client/MenuView.tsx:1–135`、`MenuView.module.css:1–80` |
| 文件页 | `packages/client/ui-sidebar-files/src/client/FilesBody.tsx:1–98`、`FilesTitle.tsx:1–25` |
| 子代理进入及只读状态 | `packages/client/ui-subagent/src/client/SubagentHeaderLineage.tsx:1–200,285–379`、`SubagentReadOnlyComposer.tsx:1–31`；未将 906 行的 lineage 文件全部声明为已读。 |
| 团队 UI | `packages/client/ui-agent-team/src/client/TeamBoard.tsx:1–112`、`TeamModeToggle.tsx:1–70` |
| 任务状态机 | `packages/team/agent-team/src/types.ts:1–188`、`task-board.ts:114–245`、`task-graph.ts:1–69`、`task-view.ts:1–55`，以及 `packages/team/tool-agent-team/src/index.ts:1–180` |

核心共享任务结构保持相同语义：`id: string`、`revision: number`、`subject/description: string`、`status: pending | in_progress | completed | deleted`、可选 `ownerId`、`blockedBy: string[]`、`writeScopes: string[]`。运行时视图增加 `ready: boolean` 和 `writeScopeWarnings: string[]`。

实现重点遵循以下边界：

- 修改任务需要最新 revision；成员身份由实际执行上下文确定，模型不能指定调用者。重复领取、非负责人修改、循环依赖、删除仍被依赖的任务均拒绝。
- 写入范围用于协调和重叠提示，不是文件锁，不增加权限；任务更新不自动唤醒成员。关闭团队保留任务，重新开启恢复。
- 查看子代理只读历史查询，不恢复 Agent、启动模型或重放工具。发送和停止才解析完整父子链；同目录的另一个根会话也不能访问此子代理。
- 子代理沿用创建时权限，不共享浏览器。已取消子代理仍可查看历史；冷态的旧 running 状态显示为中断。历史句柄回收不取消运行成员或有运行后代的父代理。
- 旧分页到达不能覆盖更新的状态或丢失实时事件；切换主会话、工作区和子代理后晚到结果不能写到新视图。展开工具、读取旧页时保留阅读位置。
- 命令输入保留原生选区、撤销、剪贴板和输入法行为；补全不把中文参数变成命令，压缩完成状态不重复渲染。

## 与参考的差异及理由

1. **编辑器**：DSH 使用 Lexical 命令节点。本产品已有原生 textarea，本轮以不可交互的镜像高亮命令，保留原生编辑行为，没有迁移整个输入引擎。若后续统一实现附件和结构化引用编辑，再评估完整节点编辑器；本轮直接迁入会扩大回归范围。
2. **子代理数据传输**：DSH 使用会话 projection/subscription；本产品保留现有 Session/RPC，通过被动历史快照及 800ms 串行轮询刷新，离开即停止。此方案存在最多一个轮询间隔的显示延迟；大量同时观察场景采用订阅更合适。
3. **团队持久化**：DSH 任务更新运行在 journal transaction。本轮使用每个根会话独立的版本化 `.agent-team.json`，在当前 Host 同步校验、原子写入后发布，不宣称具备 DSH 的任务事件重放。工作区与根会话隔离，损坏数据拒绝覆盖。
4. **团队入口**：当前 DSH 将模式开关放在模型菜单，截图展示顶部团队入口。本轮为满足截图中的可发现性，在顶部保留模式按钮，进入后显示成员及任务板；等待 Host 成功后更新，没有乐观切换。
5. **子代理输入**：DSH 有更完整的 agent lifecycle/projection 和只读原因。本轮仅支持已有产品协议能够真实执行的补充、继续和停止；已取消代理只读，未伪造恢复入口。
6. **文件与视觉**：用户明确要求暂时移除 Git 改动页，本轮按此执行。保留 React/Radix、现有工作区授权和 dock 文件预览；参考的是菜单、信息层级和操作行为，没有声明逐像素一致。

## 验证结果

本机证据目录为 `.tmp/ui-seven-points-20261104/`，不随 Git 分发。

| 检查 | 结果 |
| --- | --- |
| 新增专项测试 | 12/12 通过：团队 CAS/归属/依赖/持久化/条件工具、子代理被动读取/跨根隔离/继续/嵌套/回收、历史分页合并。日志 `targeted-final.log`。 |
| sidecar 全量 | 576 项，520 通过、44 失败、12 跳过。此前基线为 43 个失败；名称比较见 `test-comparison.json`。 |
| 额外计时失败复查 | `a prompt-shaped terminal output is only an idle hint, not proof of a pending stdin read` 在并发 Rust 编译时返回 timeout，单独复跑通过，见 `timing-recheck.log`。不能将本轮全量描述为全绿。 |
| UI 单元测试 | 76 项，73 通过、3 失败；仍为此前 `chat-scroll.test.mjs` 用普通数值模拟 scrollTop 的贴底期望。未为刷绿修改断言。日志 `ui-tests-final.log`。 |
| UI 构建、静态规则 | `npm run build:ui`、`npm run audit:ui` 通过。 |
| release 构建 | `cargo build --release --locked` 通过；Bun 1.4.4 打包 sidecar 与独立历史校验器，未引用源码绝对入口。 |
| 制品 | ad hoc 签名及 `codesign --verify --deep --strict` 通过；包内资源哈希与当前 ui-dist 匹配，签名后二进制哈希记录在外部 `artifact-manifest.json`。 |
| 包内运行验证 | 使用隔离数据实际启动包内 sidecar，历史校验器读取、团队模式状态、原生 PTY 输入及关闭通过，见 `bundle-smoke-final.log`。 |

浏览器中实际查看并操作了构建后的前端及包内 sidecar，使用隔离的本机模型响应夹具和真实 shell：两个子代理、共享任务、进入及继续子代理、返回保留草稿、压缩运行及完成、实际技能目录补全、文件路径、窄视口命令菜单。已肉眼查看截图 `command-menu.png`、`command-highlight.png`、`skill-command-highlight.png`、`commands-narrow.png`、`files-path.png`、`team-board-final.png`、`compact-running-final.png`、`compact-completed-final.png`、`bundled-subagent-continued.png`。没有新增锁定像素或间距的验收脚本。

本轮没有完整操作新包的 Mac 原生窗口，也没有复验 Windows 原生窗口、真实外部模型的自动分工效果或 Mac 分发/公证。浏览器操作和包内 sidecar 验证不替代这些平台验收。

## 本机测试入口

新包为 `.tmp/ui-seven-points-20261104/DecryptHub 界面对齐测试.app`，保留旧测试包供回退；没有替换或关闭用户正在运行的实例。它是独立固定的 release 构建，源码修改不会热更新该窗口。

新包沿用 `.tmp/macos-dev/WebDecryptHub` 的用户测试数据，**先关闭同目录的旧窗口再打开新包**，避免两个 sidecar 同写历史。自动验证使用了其它隔离数据目录，没有启动新包去并发写用户测试数据。

该包仍依赖本机 Node 24 和现有 WDH 环境，属于本机测试制品，不是可搬移到其它机器的正式 Mac 安装包。
