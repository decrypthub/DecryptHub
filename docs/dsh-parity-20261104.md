# 2026-11-04：共享工作目录的会话并发

## 问题与改动

用户报告“另一个任务正在修改此文件夹，请等它完成或使用另一个文件夹”。来源为 `sidecar/workspaces.mjs` 的进程内目录级独占 Map：`Session.send()` 在整轮任务开始时取得锁，运行中的另一个会话会阻止相同目录中的新任务。这不是磁盘上的陈旧锁，删除锁文件无法修复。

移除整个工作目录的任务独占；发送时仍验证工作目录存在和身份。每个 Agent 的运行保护、待发送队列、私有历史写租约，以及文件读版本与写前冲突检查保持原有职责。不同聊天共享同一目录时，可以独立开始和完成任务。

## 对照的参考实现

实读 `../deepseek-harness/` 中：

- `packages/core/agent-loop/src/agent.ts:122–180,224–280`：每个 ReactLoopAgent 持有自己的 phase、inbox 与 activityDone；运行状态属于会话实例，wakeDriver 防止重复驱动。
- `packages/core/agent-loop/src/index.ts:656–700`：创建 Agent/Session 使用独立 sessionId，cwd 为会话元数据；持久写入所有权取得在私有 Session 上。
- `packages/session/session-persistence-jsonl/src/lease.ts:1–99`：内核锁保护单个会话的持久文件，写进程退出释放；不独占用户项目目录，也不阻止历史读取。
- `packages/api/workspace-controller/src/index.ts:95–105` 与 `packages/workspace/workspace/src/index.ts:115–185`：工作区注册和会话活动管理分离；停止/归档以会话身份处理。
- `packages/fs/fs/src/index.ts:291–309`：文件编辑检查观察到的版本，过期版本拒绝覆盖。

保留的宿主差异：已有 Tauri/Node、项目索引、文件 hash 和 SQLite 会话日志写租约实现继续兼容本产品数据。本次仅纠正额外发明的项目目录独占，不声称变更了持久化格式或实现了所有跨进程文件事务。

## 验证结果

- 3/3 定向生命周期检查通过：共享目录两个会话同时运行、各自结束、历史独立、同会话重复发送返回 busy；旧版本文件写入拒绝且重新读取后可写；目录身份和待审批脚本变更继续受检。
- 3/3 历史写入检查通过：另一个写者被拒绝、旧读句柄不能覆盖更新代、进程死亡后内核释放写租约。项目并发不取消会话日志的独占写保护。
- 实际打包 sidecar、捆绑 Node、WS/项目/工具注册、真实 Windows PTY 与正常退出检查通过。安装验收脚本传绝对目录，避免相对路径在子进程 cwd 下被重复拼接。
- 实际 native release UI：独立数据目录、同一项目的 A/B 两个聊天，分别通过界面发送任务；A 保持运行时 B 成功发出，侧栏两个会话同时显示正在分析。释放本机 HTTP 夹具响应后，两次 Run 均为 completed。没有调用线上模型，没有触碰正式对话库。

本轮没有 UI 源码改动。未重新运行已知有历史夹具失败的全部旧检查，也未把专项结果写成全量通过。

证据在聚合目录 `.tmp/workspace-concurrency-20261104/`：源文件修改前快照、`sidecar-build.txt`、`packaged-smoke.txt`、`ui-active.txt`、`ui-active.jpg`、`ui-completed.txt` 与独立夹具数据。

## 交付边界

修复已进入源码及 `build/resources/sidecar/main.mjs` 并通过上述发布版 UI 验收。桌面上的原 `DecryptHub_1.5.0_x64-setup.exe` 没有重新生成；正在使用的安装实例没有被替换。正式安装包仍需包含这一修复后再更新。
