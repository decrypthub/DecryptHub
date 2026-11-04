# 第二轮核心对齐：终端与历史

日期：2026-11-03。继续在 `codex/dsh-parity-20261102` 隔离工作树实施；参考仓仍为 `ce7073d`，只读。完成验证后合入主源码目录，原有未提交工作保留。

## 实施决定与兼容策略

1. **终端**：移植 DSH `terminal-bash/src/sanitize.ts`、`session.ts:39–163`、`pwsh-local/src/resolve.ts` 的算法，接入同版本线 xterm/headless 6.0.0 的协议应答。按 `tool-pwsh-persistent/src/index.ts:1–490` 的所有者、命令唯一标记、串行执行、退出码和重置规则实现持久 PowerShell。终端分页、后台发送、列举和中断按 `experimental/tool-terminal/src/index.ts:175–460`；Windows 缺少原生前台探针时仍不伪造 stdin_read/进程组 ID。
2. **原始日志与模型视图分开**：DSH `core/session/src/types.ts:450–520`、`surface.ts:300–450` 要求区间替换携带全部来源事件，替换不删除原日志。修复本产品摘要提交后丢弃保留尾部的问题，引入同语义的 surfaceOp/sourceEventSeqs。新的历史版本为 v3；接受 v1/v2 并保留原事件，首次写入升级；旧 v2 应用的版本门拒绝 v3，避免错误回放。不直接迁移或重写用户正式数据。
3. **分支**：DSH `client/ui-chat/src/client/apply.ts:301–310` 与 `api/session-controller/src/commands.ts:213+` 从精确事件位置建立分支。编辑重发改为新分支；源会话不截断，附件与输出引用随精确前缀复制。失败时不切走源会话。兼容原 RPC，返回新 sessionId 供 UI 跟随。
4. **历史查询与引用**：依据 `experimental/tool-session-query/src/{index,input,operations,workspace-access}.ts`、`session-query/src/{extraction,tracing,observation}.ts`、`context/session-reference/src/{uri,projection,index}.ts`。模型查询限制相同 cwd；以实时日志优先，冷读不启动 Agent；搜索排除推理、请求凭据和运行环境注入；自身检索排除当前步骤。用户明确引用是不可变、只读、非可信的会话快照，独立保存，不用实时读取改写既有引用。

## 退出条件

用真实 PTY 检查持久状态、静默长命令、非零退出、取消与超时、终端协议应答、输出分页和所有者隔离；通过实际 Agent 循环检查压缩尾部、分支和跨会话查询；最后构建独立 release，在 UI 验收分支、引用、历史恢复以及实际模型工具调用。未执行的场景不得算通过；保留旧脚本的失败记录，不修改它们刷绿。

## 已取得的验证结果

- 首次定向检查 62/62 通过，包含真实 PTY、PowerShell 的变量/cwd/环境持久、原生非零退出码、静默长命令、超时重置、顶层退出后重开、手动关闭后重建、真实 CPR 协议应答、按输入审批、所有者隔离、分页和后台作业。
- 历史方面通过真实 Agent 的摘要提交/恢复、重复区间替换、未知可忽略事件保留序号、损坏替换拒绝、冷读不启动 Agent、实时优先、同工作区围栏、当前步骤排除、精确分支、编辑后源文件字节不变、引用不可变/排除工具推理/安全序列化/预算与溢出归档。
- 旧兼容检查 189 项：170 通过、19 失败。失败记录逐条保留于聚合目录 `.tmp/dsh-parity-20261103/compatibility.txt`：旧目标接口与无进展停止规则、旧只读研究助手、固定事件位置和 v2 断言、忽略事件后压缩序号、损坏 JSON 静默变空、Anthropic 不含缓存的输入计量、把提示符当作确定 stdin_read，以及供应商拒绝思考参数后静默删参数。未修改旧脚本使之通过，也没有报告全量通过。
- 第一版 release 已实测 `@` 候选选择、真实 DeepSeek 引用快照回答、`session_search` 和 `session_event_read` 的完整工具循环、回复位置分支。源会话 SHA256 在分支前后不变。
- UI 验收发现：编辑重发后完整回复已保存，但新分支快照在首 token 前覆盖 assistant-start，导致增量与完成回执找不到消息。保留空的活动消息标识，并让权威完成回执补回缺失消息；新增实际 Agent 首 token 前快照场景。相关对话/推理/快照验证 16/16 通过。该 UI 问题在首次验收时判失败，需用重新构建的 release 复验，不沿用第一次的观察宣称修复通过。

## 最终复验与交付

- 最终定向检查 **78/78** 通过；Windows 运行完整性检查另 **3/3** 通过。合入主源码、安装匹配依赖后同批检查 **81/81** 通过。前端构建、控件静态审计、Cargo release 均成功。保留现有构建警告，不把旧兼容套件写成全绿。
- 最终 release EXE 的 SHA256 为 `127bbcc568b40c04f5e7afcaac35a7270eefbd309e191d4deec3c45a2f8c96c8`，实际 Cargo 输出为 `src-tauri/target/release/jsra-tauri.exe`；sidecar SHA256 为 `05b6a79d4b9daf89558d1b5c10fddeb95bfca4c1e848b98c98dc49c7c167e0e1`。
- **真实 UI 修复复验通过**：重启后保留引用、历史、项目与 DeepSeek 模型/最高思考档；再次编辑重发创建新分支，模型的「快照修复通过 C」即时显示，无需切换会话或重启。被编辑的源会话文件 SHA256 与操作前相同。最初那次漏显示保留为失败记录，不计作通过。
- **发布路径复验通过**：直接使用包内 Node、terminal-entry.cjs、node-pty、headless，验证持久变量和真实前台程序的 CPR 应答。首次检查发现复制后的 WinPTY helper 继承低完整性标签，导致发布包终端无法启动；构建现在同时准备 PTY 辅助 EXE。修复后侧栏终端实际启动，提示符 cwd 为本轮隔离 workspace；未通过 UI 输入终端命令。PowerShell 5.1 的测试探针采用实际脚本文件，避免原生命令行引号规则污染协议检查。
- 交付目录：隔离工作树 `artifacts/dsh-parity-20261103/DecryptHub-win-x64`，以 `start.cmd` 启动；默认数据为聚合目录 `.tmp/dsh-parity-20261103/appdata`，不使用正式数据。本机供应商密钥沿用系统凭据库，未写入包。没有替换当前安装版、没有提交或推送。
- 源码合入采用相对开工前完整树的累积补丁；合入前校验主工作区 HEAD、完整 dirty 清单、tracked diff 和 untracked 内容全部不变；只应用本次增量，不触碰原索引。合入与逐文件验证回执保存在聚合目录 `.tmp/dsh-parity-20261103/`。

仍需继续对齐：完整代际 JSONL、SQLite FTS5/BM25 检索索引与排序、4MB 以上修改审阅/版本保存、更多原生供应商协议和完整技能供应商。Windows 原生前台输入探针也仍有后端差异。没有将这些项目算作完成。
