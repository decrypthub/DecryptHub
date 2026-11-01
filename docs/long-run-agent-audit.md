# 长期运行型 Agent 桌面端审计（Lead 版）

范围：`DecryptHub-Desktop` 的 Agent 会话、工具、审批、目标、后台任务与 WDH 浏览器组件；以用户真实长链路反馈为线索，逐条对照源码。文中“已确认”指读过对应实现；“推断”指根据错误传播链推断，尚未在真实站点复现。

结论：骨架（工作区 + 脚本 + 浏览器 + 抓包 + 后台任务）可用，但**状态权威、授权复用、可观测性、能力闭环**四件事没做到长期任务需要的程度。用户反馈的 10 条里，大部分不是模型能力问题，而是工具层状态机与产品信息设计问题。

---

## 一、已确认的根因（按用户优先级）

### 1. 浏览器暂停状态自相矛盾（P0）
- 快照门槛：WDH `src/browsertools.mjs:44` 用 `paused()` 的文本匹配（`get_paused_info` 输出含 `Execution Paused|Call Stack`）直接拒绝 `browser_snapshot`；`src/browsertools.mjs:6`。
- 交互门槛：`interaction()`（`src/browsertools.mjs:15` 起）同样依赖该文本；暂停时点击/填写被拦。
- 调试器自身的 `get_paused_info` 用 `debugger_.getPausedState()`（WDH vendor `tools/debugger.js:921`）判断；`pause_or_resume` 又用 `debugger_.isPaused()`（`:1036/1044/1080`）。
- 两套判断在 target 重建、页面导航、站点反调试脚本自行恢复/断连时可能不一致：一边是 MCP 文本缓存，一边是 CDP 会话状态。用户遇到的“snapshot 说暂停、resume 说没暂停、evaluate 又说没暂停”正是典型的**状态权威分裂**。
- 风险：没有 `browser_reset`/target 重建路径，三条路都堵死，只能换站点。

修复设计：
1. 单一权威：暂停状态只由 CDP `Debugger.paused/resumed` 事件维护，`paused()` 与快照门槛读同一状态；`get_paused_info` 文本匹配仅作展示。
2. 自愈：任何 `Can only perform operation while paused` 或 `not paused` 冲突，自动清理调试器会话并重建 target，然后返回“已恢复，请重新读取页面”。
3. 工具：`browser_reset()`（重建当前 target、保留其它标签）与 `browser_close_tab`；`browser_snapshot` 在 paused 时返回结构化 `{paused, callFrames, hint}` 而不是纯文本拒绝。

### 2. 多标签/上下文隔离（P0，部分已修）
- WDH 本身有 `new_page`（vendor `tools/pages.js:134`）和 `select_page`，但 MCP 桥把它们放进 `HIDDEN`（`src/mcp.mjs:9`），模型默认看不见；Desktop 只暴露了 `browser_tabs/browser_select`。
- 本轮已加 `browser_new_tab`（Desktop `sidecar/browsertools.mjs` + `sidecar/wdh-tools.json`），直接复用 WDH `new-page`，不再需要离开表单页。
- 仍缺：标签页级上下文（当前会话共享 cookies/profile 是合理的，但“当前调试目标/抓包过滤/脚本 ID”应按标签隔离）；关闭标签后的 target 失效提示；`browser_new_tab` 与 `browser_select` 的返回需包含 `tabId` 而非仅 index。

### 3. 审批不可持久、拒绝不解释（P0）
- `Session.execute()`（`sidecar/sessions.mjs:161-171`）对未隔离执行/网络访问要求审批；拒绝只抛“用户未批准执行，命令没有启动”（本轮已改为说明“需要批准的是：网络访问 X / 未隔离进程执行”，见 `sessions.mjs`）。
- 复用粒度：`approve()` 用 `scopeKey = hash(file,args,input,guardFiles,cwd,network,workspace,isolated)`（`sessions.mjs:164-189`），同一条命令改一个参数即需要重新批准；`canRemember` 只在 `isolated` 时允许（`:167`），隔离不可用时永远逐次批准。
- `networkDomains` 是每个命令的数组（`workspace_shell` schema），扫描 584 主机时要么逐域批准，要么改走 node fetch（又一次审批）。
- 自动批准只覆盖隔离 npm registry（`policy.autoReview`），不含“只读 GET 某域”这类安全动作。
- 修复设计：会话级 grant 维度从“命令哈希”改为“动作 + 主机/路径前缀 + 隔离级别”，例如 `net:GET:target.example`、`shell:node:<workspace>/probe.js`；拒绝时返回结构化 `approval-needed {category, hosts, action, retryAfterApproval}`；UI 提供“本会话允许该域名”的一次性勾选。

### 4. 后台任务无心跳、输出不可观测（P1，部分已修）
- 原 `jobText()` 只给 status/pid（`sidecar/workspace.mjs:128`），`workspace_job_output` 只有 offset 分页（`:132`），没有“运行了多久/已产生多少输出”；5 分钟无输出确实无法区分运行与卡死。
- 本轮已加：`time=Ns out=NB err=NB` 心跳字段、`tail=true` 读最后 20KB、子进程 `PYTHONUNBUFFERED=1/PYTHONIOENCODING=utf-8/PYTHONUTF8=1/NO_COLOR=1`（`sidecar/executor.mjs`）。
- 仍未解决：进度心跳需要**任务自身**输出；建议 `workspace_shell` 提供 `progressEveryMs` 包装（定时打印 `alive pid elapsed`），或 `workspace_job_output` 在无输出时返回 `{running, elapsedMs, silentMs, lastLine}`；`offset` 应基于字节而非 UTF-16 码元（当前 JS string slice 对中文安全，但和用户脚本自己的字节 offset 对不上）。

### 5. Windows/PowerShell 中文乱码（P1，部分已修）
- 原 `shellSpec` 直接 `powershell -Command <cmd>`，控制台代码页默认 GBK，Tee/Select-String 会输出 `�?`。
- 本轮已在命令前注入 `[Console]::OutputEncoding=[Text.Encoding]::UTF8; $OutputEncoding=[Text.Encoding]::UTF8;`（`sidecar/executor.mjs` shellSpec）。
- 仍需真机验证：Windows PowerShell 5.1 下 `Tee-Object`/`Select-String` 的组合、以及 `chcp 65001` 是否需要在父进程设置；计划加 `--encoding raw|utf8|auto` 的 `workspace_read` 视图，避免历史乱码文件无法读取。

### 6. 目标 blocked 后仍自动接续（P1，已加回归测试）
- `updateGoal()` 把 `blocked` 映射为 `needs_attention`（`sidecar/goals.mjs:29`），`GoalDriver.schedule()` 只调度 `status==='active'`（`:49-58`），`finishGoalRound()` 自动轮 no-progress 也会置 `needs_attention`（`:38`）。按当前代码，blocked 后**不应该**继续唤醒。
- 用户实际遇到的循环更可能是：`goal_update(blocked)` 在目标已暂停/不是当前 goal 轮次时被拒绝（旧错误提示“只有用户通过 /goal 启动的目标才能更新”，与事实不符），目标保持 active，驱动继续接续。本轮已改为精确区分“没有目标 / 目标已暂停 / 没有活动轮次”（`sidecar/sessions.mjs` updateGoal），并加测试证明 blocked 后不再唤醒。
- 仍缺：当模型用**自然语言**说“等你拍板”而没有调用 `goal_update(blocked)` 时，驱动无法识别，会继续接续。修复：ask_user/question/plan 工具触发时自动把 goal 置 `needs_attention`，或 continuation 提示“若上一轮以提问结束则不要自动接续”。

### 7. Subagent 不能验证、结论截断（P1）
- 子代理只挂 `workspace_list/read/grep`（`sidecar/subagents.mjs:6-18`），没有 HTTP/browser，因此“判断真实性”只能推理；`maxSteps:10`、5 分钟超时、token 上限 40k（`:26-27`），结论只取最后一条 assistant 文本并截 18k（`:28-30`）。
- 修复：给子代理只读网络能力（`http_get` 白名单、最多 N 次、结果落盘到工作区），主代理只读结论文件；结论超长时落盘 `subagent-<id>.md` 并在 record 里保存路径；支持 `agent_wait` 返回 `summaryPath`。

### 8. 表单/附件链路缺失（P1，本轮补 upload）
- WDH 没有文件上传工具；`take_screenshot` 虽支持 `filePath`（vendor `tools/screenshot.js:11`），但默认只回附件，不说明落盘位置。
- 本轮新增 `browser_upload(selector, path)`（Desktop `sidecar/browsertools.mjs`，需 standard 审批，路径限制工作区），并在 system prompt 里要求“先 take_screenshot(filePath=工作区路径) 再 browser_upload”。
- 仍缺：截图默认落盘到工作区 `artifacts/` 并返回相对路径；多文件上传；`browser_press` 后等待上传完成的语义。

### 9. 技能/记忆不沉淀（P2）
- 只有手动 `skill_manage`/`memory_manage`；system prompt 只注入“索引存在，按需读取”的提示（`sidecar/agent.mjs:302`），不会自动把本次结论写回项目。
- 修复：会话结束/目标完成时，询问或自动生成 `project skill` 草稿（规则、判定口径、已扫范围、可复核证据），下一次会话按项目注入摘要；提供“不要自动沉淀”设置。

### 10. 状态表达靠自然语言（P1）
- `publicState().goal` 有 summary/criteria/nextAction，但 UI 没有结构化“待审批提交/待授权 payload/扫描中”；`goal_update` 旧错误提示与事实不符（本轮已修）。
- 修复：goal 增加 `phaseDetail`（如 `{kind:'awaiting-approval', what, since}`），UI 用状态徽章渲染；工具返回里带 `goalRevision`，避免“不知道目标是否在推进”。

---

## 二、用户没提但长期使用会踩的缺陷

1. **切换工作区会杀后台任务并清空本会话授权**：`setWorkspace()` 里 `killAllJobs` + `allows.clear()`（`sidecar/sessions.mjs:154`）。长扫描切项目=前功尽弃，且重新审批。建议任务按 workspace 归属，不因会话切换而杀；授权按 workspace 保留。
2. **审批 5 分钟超时静默拒绝**（`sessions.mjs:200`）：长调查中用户离开一下，命令被拒且无提醒。建议超时前发通知、超时后保留 pending 可重试。
3. **上下文压缩只保摘要，不保证据文件索引**：长任务多轮压缩后，原始工具结果和截图路径丢失，模型重新摸索。建议压缩时保留 `artifact index`（文件路径+hash+用途）并在下一步注入。
4. **浏览器 target/scriptId 生命周期没有显式失效通知**：导航/重启/切换页面后，旧 scriptId、断点、frame 只在工具返回文本里提示，模型容易复用旧值。建议工具返回结构化 `targetGeneration`，过期调用直接拒绝并给新 generation。
5. **工具可发现性**：`new_page/navigate_page/select_page` 被 `HIDDEN`（`WDH src/mcp.mjs:9`），Desktop 只暴露部分包装；模型需要 `discover_tools` 才能看到调试器分组。建议按场景默认暴露“导航/标签/上传”这些基础动作，而不是让模型猜。
6. **会话恢复只恢复事件，不恢复“正在等待什么”**：`askPending`/`pending` approvals 不落盘；重启后用户不知道上次卡在哪。建议把 pending question/approval 写入 state 并在 UI 显示“上次在等你回答 X”。

---

## 三、案例复盘

**案例 A：WZWS 反调试暂停死锁**
触发断点 → `browser_snapshot` 被 `paused()` 拒绝 → 模型试 `pause_or_resume(resume)`，调试器认为未暂停 → `evaluate_script` 又要求暂停。三条路互斥，根因是“文本缓存/CDP 状态/工具前置条件”三套权威。正确产品行为：任一冲突自动重建 target，或提供 `browser_reset` 并明确告知“会丢失当前断点现场”。

**案例 B：584 主机扫描**
`networkDomains` 逐命令白名单 + scopeKey 含完整命令哈希 → 每个目标/每次参数变化都要批；`workspace_job_output` 无心跳 → 5 分钟沉默；中文乱码 → 无法读里程碑。三者叠加导致用户改用 node fetch 绕开，而 node 执行又要审批。正确产品行为：会话级 `net:GET:*.target` grant + 任务心跳 + UTF-8 默认。

**案例 C：表单 + 附件提交**
没有 `upload_file`，截图默认不回路径，模型无法完成最后一步；本轮补了 `browser_upload` + 截图落盘指引，但还需要默认 artifacts 路径和多文件支持。

---

## 四、路线图

### P0（1–2 周）
- 浏览器状态单一权威 + 冲突自愈 + `browser_reset`；标签页 target 隔离。
- 会话级 grant（动作+主机/路径前缀）与结构化拒绝说明。
- 任务心跳/tail/UTF-8 收尾（真机验证 Windows）。
- 上传链路默认化（截图落 artifacts、upload 多文件）。

### P1（2–4 周）
- blocked/等待用户时真正暂停自动接续；ask_user 触发 goal needs_attention。
- 子代理只读 HTTP + 结论落盘；主代理只读摘要。
- 结构化状态（goal phaseDetail + UI 徽章）；会话恢复 pending 状态。
- 审批超时通知与可重试；切工作区不杀任务。

### P2（1–2 月）
- 项目级 skill/memory 自动沉淀与注入。
- 上下文压缩保留 artifact index；target generation 语义。
- 多标签上下文隔离（调试目标、抓包过滤、脚本 ID）。

## 五、需要产品决策
1. 子代理是否允许联网（只读 GET、白名单、落盘）——安全 vs 验证能力。
2. 是否自动把结论写成项目 skill（默认开/询问/关）。
3. Windows 终端输入阻塞（另见 PR #9 CI）需要真实 Windows 环境；与本次审计独立。

## 六、本轮已落地代码（PR #9）
- `browser_new_tab`：保留当前页表单状态，新开探测页。
- `browser_upload`：工作区文件选择到 `<input type=file>`，标准模式需审批。
- 后台任务：心跳字段、`tail` 读取、UTF-8/无缓冲子进程环境、PowerShell 输出编码。
- 目标：精确的“无目标/已暂停/无活动轮次”错误；blocked 后不自动接续的回归测试。
- 审批拒绝：说明缺少的具体授权与补救路径。
- 测试：`browser-new-tab.test.mjs`、`harness-lifecycle.test.mjs`、`workspace-agent.test.mjs`；全量 292 通过、3 跳过。
