# 长跑型桌面 Agent 使用审计

> 对象：`DecryptHub-Desktop`（分支 `codex/workspace-tabs-and-compact-menus`）+ `WebDecryptHub-Runtime`（WDH 组件，含 vendored 内核 `src/vendor/core-build`）
> 方式：只读代码走查 + 真实会话日志复盘 + 本机可重跑的只读复现
> 基线：审计开始时 HEAD `691f23d`，写作过程中作者合入 `c42f471`、`7ca6bce`（13:46 / 13:49），本文按 **`7ca6bce`** 复核，并标注"审计期间已修 / 仍缺"。
> 追加状态：`browser_upload` 因页面代理契约不一致已被移除（见 §8.2），避免把不可用工具发给模型；待组件侧提供正式 upload action 后再恢复。
> 时间：2026-11-01 13:42–14:05（CST）。全程只读，未改动任何源码；唯一写入是本文件。

---

## 0. 怎么读这份报告

### 0.1 证据分级

| 标记 | 含义 | 复核方式 |
|---|---|---|
| **A｜日志** | 真实会话事件日志里的原文/计数 | `.tmp/macos-dev/fresh-backup-20261030-232332/projects/*/.agent-history.json`，文中给事件序号 `e123` |
| **B｜代码** | 源码可闭合的因果链，读代码即可确认 | 文中给 `文件:行号`（基线 `7ca6bce`） |
| **C｜复现** | 我在本机只读复现过，命令可重跑 | 附录 A 给了命令与输出 |
| **D｜推断** | 由 A/B/C 推出，但没有直接观测 | 文中会明说"未验证" |

不写"疑似""可能"来掩盖不确定；拿不准的地方一律标 **D**。

### 0.2 真实会话样本

| 会话 | 任务 | 事件 | 工具调用 | 工具错误 | 最大步数 | 自动接续 | 结束状态 |
|---|---|---:|---:|---:|---:|---:|---|
| `default` | 小红书 X-S 纯算法，长跑 | 591 | 274 | 31 (11.3%) | **101** | **6** | completed×10 / interrupted×4 / error×1 |
| `s7e8dbe8…` | 百度+地图找"文化大道健身房" | 164 | 78 | 16 (20.5%) | 76 | 0 | completed×2 / interrupted×1 |
| `s6990402…` | 建自动化任务 / 多轮 | 150 | 76 | 10 (13.2%) | 55 | 0 | completed×3 / interrupted×2 |
| `sa2e1213…` | 知乎加密分析 | 61 | 33 | 5 (15.2%) | 26 | 0 | interrupted×1 |

合计 **461 次工具调用、62 次失败（13.4%）**。这个失败率本身不是"模型不行"的证据——下文的根因几乎全部落在工具状态机、审批链路和可观测性上。

其它实测基线（**A/C**）：

- `default/.agent-history.json` = **1.14 MB / 591 事件**；单次 `JSON.stringify + write + fsync` 实测 **8.65 ms**，且**每次 append 都会写一遍全量**（§E4）。
- `default/.capture` = **111 MB**，`s7e8…/.capture` = **121 MB**，无保留策略（§E5）。
- 5 个子代理记录 **5/5 均为 `limited`**（预算/步数耗尽），0 个 `completed`（§7）。
- 测试基线：`node --test sidecar/test/*.test.mjs` → **293 tests / 290 pass / 3 skipped / 0 fail**（`browser_upload` 移除后重新计数；含新增的 `browser-new-tab.test.mjs` 与 blocked-goal 回归）。

### 0.3 总览

| # | 用户反馈 | 代码可确认 | 当前状态（`7ca6bce`） | 优先级 |
|---|---|---|---|---|
| 1 | 暂停后 snapshot/resume/evaluate 全堵 | 是，**状态权威分裂** | 未修 | **P0** |
| 2 | 没有 new_tab | 是（旧版） | `c42f471` 已加工具；缺 capability 与返回结构 | P1（降级） |
| 3 | 审批横跳 / 拒绝不解释 / networkDomains | 是，**五处独立机制** | 拒绝文案已修；探针改为真实隔离自检（本轮） | **P0** |
| 4 | 后台任务无心跳、offset 错位 | 是 | `c42f471` 加了心跳字段；offset 仍不稳定 | P1 |
| 5 | PowerShell `�?` | 是（编码） | `c42f471` 加了 UTF-8 前缀；仍有分块/文件编码坑 | P1 |
| 6 | blocked/等用户仍被接续 | **部分**：`blocked` 已被阻断，"自然语言提问"没被阻断 | 未修 | P1 |
| 7 | 子代理不能验证、结论截断 | 是，**5/5 limited** | 未修 | P1 |
| 8 | 没有 upload_file、截图无路径 | 是；曾加的 upload 运行时报错 | upload 已移除；截图路径仍缺 | **P0** |
| 9 | skill/memory 索引为空 | 是（无自动沉淀） | 未修 | P2 |
| 10 | 无结构化状态、goal_update 报错不符 | 部分（报错已修，状态仍缺） | 半修 | P1 |

---

## 一、逐条核实

### 1. 浏览器暂停后三条路全堵（P0）

**结论：确认，且是一个可完整复原的状态机死锁。【A+B】**

#### 关键位置

| 环节 | 位置 | 行为 |
|---|---|---|
| 暂停状态唯一写入点 | `WebDecryptHub-Runtime/src/vendor/core-build/src/DebuggerContext.js:130-186` | 只由 CDP `Debugger.paused` / `Debugger.resumed` 事件维护 `#pausedState` |
| resume | 同上 `:202-212` | `if (!isPaused) throw`；否则 `#client.send('Debugger.resume')` |
| pause/resume 工具 | 同仓库 `src/tools/debugger.js:1032-1053` | resume 用 `isPaused()` 做前置判断，失败统一包成 `[CDP_ERROR]` |
| evaluate 选择路径 | 同仓库 `src/tools/script.js:286-295` | `if (debugger_.isEnabled() && debugger_.isPaused())` → 走 `evaluateOnCallFrame` |
| 快照硬门槛 | `WebDecryptHub-Runtime/src/browsertools.mjs:6, 44` | `paused()` 读 `get_paused_info` 文本，命中就**拒绝** `browser_snapshot` |
| 交互硬门槛 | 同上 `:15-30` | 暂停时拒绝 click/fill/press |
| 宿主侧"恢复"按钮 | `sidecar/index.mjs:260`（`debug-resume`） | 走同一条 `pause_or_resume`，同样失败 |
| 断线重连 | `WebDecryptHub-Runtime/src/mcp.mjs:55-56`、`sidecar/sessions.mjs:309-314` | `selectTarget` 直接抛"调试器连接已断开" |

#### 根因（状态机层）

1. `#pausedState` 是**纯事件缓存**，没有与 CDP 会话做任何对账。页面导航/重载/渲染进程被丢弃时缓存不会自动失效，就永久停在 `isPaused: true`，`callFrames[].callFrameId` 同时失效。（**D**：导航后 Chrome 是否补发 `Debugger.resumed` 属推断；但「缓存显示暂停、CDP 会话显示未暂停」这个事实由日志 `e69/e71/e81/e83` 直接证明。）
2. 于是五个工具各自读到**不同的"真相"**：
   - `get_paused_info` / `pause_or_resume(pause)` 读缓存 → "已暂停"（甚至返回 `CONFLICT: already paused`）；
   - `Debugger.resume`、`evaluateOnCallFrame`、`stepOver` 读真实会话 → `Can only perform operation while paused`；
   - `browser_snapshot` 读缓存 → 直接拒绝，连只读页面都不给。
3. 没有任何工具能"清缓存并重建 target"。`discover_tools(debugger)` 只重建 MCP 桥、不重置内核的 `paused` 状态（桥已经死了时甚至是个 no-op，见 §E3）；`reset_session` / `restart_browser_fresh` 是破坏性的（清 Cookie / 换 Profile），代价远大于收益。

#### 日志证据（会话 `s7e8dbe8…`，`A27`–`A51`，25 个决策步）

```
e64 A27 evaluate_script  → e65 [INTERNAL] Debugger.evaluateOnCallFrame: Can only perform operation while paused
e66 A28 browser_snapshot → e67 网页暂停于断点，暂不读取 DOM 快照…
e68 A29 get_paused_info  → e69 🔴 Execution Paused（栈在 quc7.js，即 360 的反调试脚本）
e70 A30 pause_or_resume(resume) → e71 [CDP_ERROR] Debugger.resume: Can only perform operation while paused
e78 A34 list_breakpoints → e79 No active breakpoints.   ← 我们没下过断点，暂停来自页面自身
e80 A35 pause_or_resume(pause)  → e81 [CONFLICT] Execution is already paused
e82 A36 pause_or_resume(resume) → e83 [CDP_ERROR] 同 e71
e90 A40 step           → e91 [CDP_ERROR] Debugger.stepOver: Can only perform operation while paused
e94 A42 evaluate_script → e95 同 e65
e102 A46 evaluate_script → e103 [工具错误] 调试器连接已断开
e104、e112 两次 discover_tools(debugger) 之后仍然 e107/e113 同样报错
```

最终模型**放弃 evaluate_script**，改用 `browser_snapshot` 抓文本（e116 之后），任务质量直接降级。

#### 影响

- 一次暂停 = 该标签页的调试能力报废，只能关浏览器/重启应用；用户原话"需要 browser_reset 自愈"就是这个意思。
- 更糟的是 `browser_snapshot` 也被连坐：**只读观察**被一个坏标志位否决，模型失去唯一的"退一步"路径。
- 带反调试脚本的站点（本例是 360 的 `quc7.js`）恰恰最容易触发，等于在最有价值的场景里失效。

#### 修复设计

1. **单一权威 + 对账**（内核）：在 `DebuggerContext` 上监听 `Page.frameNavigated`、`Runtime.executionContextsCleared`、`Inspector.detached`，任一发生即 `#pausedState = {isPaused:false}`；同时给状态加 `generation`，工具调用携带 `generation`，过期直接拒绝并提示重读。
2. **resume 幂等**：`Debugger.resume` 抛 `Can only perform operation while paused` 时，视为"已经不暂停"，清状态并**返回成功**（`{resumed:true, recovered:true}`），而不是把它变成第 5 条死路。
3. **新增 `debugger_recover` 工具**（非破坏性）：`DebuggerContext.disable()` → `enable(newSession)` → 清 callFrames → 可选 `Page.reload`；返回 `{paused:false, targetGeneration}`。它对齐用户心里的 `browser_reset`，但**不清 Cookie、不换 Profile**。
4. **快照降级**：`browser_snapshot` 命中 paused 时不再硬拒绝，返回 `{paused:true, callFrames, text:"（页面已暂停，以下是暂停前快照）"}`；只有 `evaluateOnCallFrame` 这类必须暂停现场的操作才硬失败。
5. **宿主侧**：`debug-resume` 改为先调 `debugger_recover` 再 `pause_or_resume`，"恢复执行"按钮从此可用。

#### 验收标准

- 在 paused 页面执行 `browser_open`（同标签导航）后：`get_paused_info` 一次调用内报告 `isPaused:false`；`browser_snapshot` 正常返回。
- 对已恢复的页面调用 `pause_or_resume(resume)`：返回成功而不是 `CDP_ERROR`（幂等）。
- 注入 `Debugger.paused` 后丢弃 `resumed` 事件的单元测试：`debugger_recover` 后所有调试工具恢复；`harness-lifecycle.test.mjs` 增补该用例。
- 回归：`s7e8` 那 25 步的日志可回放为 fixture，回放后不再出现 `Can only perform operation while paused`。

---

### 2. 只有 browser_tabs/select，没有 new_tab（P0 → 已修，P1）

**结论：旧版确认；`c42f471` 已补 `browser_new_tab`，但没补完。【A+B】**

#### 关键位置

- 旧版模型可见工具（日志 `e27`，共 60 个）里**没有** `browser_new_tab`，只有 `browser_tabs` / `browser_select`。
- 内核其实有 `new_page`，但被桥接层隐藏：`WebDecryptHub-Runtime/src/mcp.mjs:9` `HIDDEN = ['select_page','new_page','navigate_page','click_element']`。
- 组件侧 `new-page` 是存在的：`sidecar/browser.mjs:221`（`control('new-page')`），但旧版没有模型工具指向它。
- 修复：`sidecar/wdh-tools.json` 新增 `browser_new_tab`，`sidecar/browsertools.mjs:9-13` 分发到 `ctx.browser.newPage`，`policy.mjs` 归入 READ。

#### 根因

工具暴露面与组件能力**不是同一张表**：组件有 `new-page`，桥接层却只把 `tabs/select` 暴露给模型。`browser_open` 的实现是"有浏览器就 navigate 当前页"（`sessions.mjs` 的 `openBrowser`），所以在**单标签**模型下"保留表单页 + 探测另一页"在物理上不可能。

#### 日志证据

`e2/e16/e20/e36/e46/e52/e62/e74/e96/e100/e118/e122/...` 一共 **24 次 `browser_open`、24 次 `browser_snapshot`**，在同一标签里反复覆盖（腾讯地图 center 参数不生效，只能"再开一次试试"），每次都丢失上一页状态。

#### 影响

- 表单填到一半去查一个接口 → 页面被覆盖 → 重填（还可能触发风控）。
- 多目标比对（A 站 vs B 站）只能串行重开，抓包列表也被搅乱。

#### 仍缺（新代码的问题）

1. `browser.mjs:221` 的 `newPage` **没有 capability 守卫**，而同文件 `selectPage/closePage` 都有 `capabilities.pageTabs` 检查。旧组件上会得到 `Unsupported WDH desktop operation: new-page`，错误信息对模型不可读。
2. 返回只有一句文本，没有 `{pageId, url, index}`；`browser_tabs` 返回的是 `index`，两套标识不统一，模型容易 select 错页。
3. `browser_new_tab` 在 `policy.mjs` 是 READ，但"打开任意 URL"实际上是外联动作；与 `browser_open` 保持一致可以接受，但应写进工具描述（"会建立新的网络连接"）。
4. UI 侧没有"复制当前标签"的人类入口，只有模型能用。
5. 标签级上下文没有隔离：调试目标、抓包过滤、`scriptId` 都是会话级的；`browser_select` 的描述已经提示"跨页面调试会重建调试上下文，旧 scriptId 和断点不能当成新页面状态"，但没有结构化的 `tabId + generation` 让模型判断"这个 id 属于哪一页"。

#### 验收标准

- 真机：A 页填 3 个输入框 → `browser_new_tab(B)` → `browser_select(A)` → 3 个值仍在（组件级 e2e，不是单测）。
- 旧组件（`capabilities.pageTabs !== true`）下调用返回可读错误："请更新 WebDecryptHub 组件以支持多标签"。
- `browser_tabs` 与 `browser_new_tab` 返回同一个 `pageId` 字段。

---

### 3. 审批在 full-access / standard 间横跳，拒绝不解释，networkDomains 不可用（P0）

**结论：确认。是五个独立机制叠出来的体感，只修文案解决不了。【A+B+C】**

#### 3.1 为什么"横跳"——full-access **从不落盘**（B）

```js
// sidecar/sessions.mjs:61   读取时就把 full-access 降级
this.mode = st.mode === 'full-access' ? 'standard' : normalizeMode(st.mode);
// sidecar/sessions.mjs:93   写入时也强制写 standard
atomicJson(this.stateFile(), { mode: this.mode === 'full-access' ? 'standard' : this.mode, ... });
```

- 这是**有意设计**：UI 的确认框写着"此选择仅对当前会话、本次应用运行有效"（`ui/src/workspace.jsx:18`）。
- 但后果是：用户为了跑通命令切到 full-access → 重启应用 / 重开会话 → 静默回到 standard → 同一个脚本又开始弹审批。**用户感知到的"横跳"就是这个**，而且对话里没有任何一行字解释"权限被降级了"。
- 备份里的 6 个会话状态文件全部是 `"mode":"standard"`，与该机制一致。

另外两个不对称会加剧"同一脚本时好时坏"：

```js
// sessions.mjs:109  运行中升到 full-access：把正在等待的批准直接放行
if (running && next === 'full-access') for (const p of [...this.pending.values()]) p.finish(true);
// sessions.mjs:103-104  空闲时切任何模式：直接拒绝所有 pending + 杀掉所有后台任务
killAllJobs(this.projectDir); this.allows.clear();
```

- 同样一次审批，**在弹窗期间用户切了模式**，结果可能是"自动通过"也可能是"自动拒绝 + 后台任务全灭"。
- `setMode` 的注释说"只改判定依据，不杀终端和后台任务"，但只在 `running` 时成立；空闲时切换会 `killAllJobs`（`sessions.mjs:103`）。长扫描时用户点一下权限下拉，任务就没了。

#### 3.2 为什么"时好时坏"——沙箱探针说谎（**P0，最硬的根因**）

```js
// sessions.mjs:164
const capability = await executor.probe();
const isolated = this.mode !== 'full-access' && capability.available;
```

- `probe()` 只跑 `sandbox-entry.mjs --probe` → `checkDependenciesAsync()`（`sidecar/sandbox-entry.mjs:9-11`），**不真正 initialize**。
- 我本机跑 `node sidecar/sandbox-entry.mjs --probe` → `{"available":true,"errors":[],"warnings":[]}`（C）。
- 但真实会话里，standard 模式的隔离执行**每次都失败**：

```
[执行隔离失败，未降级运行] listen EINVAL: invalid argument
```

  在 `s6990402…` 出现 8 次、`sa2e1213…` 2 次、`default` 1 次（A；其中 1 条是 `workspace_job_output` 回显的 stderr，实为 10 次执行失败）。失败点在 `sidecar/sandbox-entry.mjs:39` 的 catch（initialize / wrapWithSandboxArgv 抛错），不是用户脚本自己 listen。

- 结果：**standard 模式下 `workspace_shell` / `workspace_run` 基本不可用**；用户切到 full-access 才能跑；重启又回 standard。这就是"同一脚本时好时坏"的完整闭环。
- 更糟的是失败信息 `[执行隔离失败，未降级运行]` 是给开发者看的，模型拿到后只会重试或换命令，不会想到"该切权限"。

**修复（本轮，Lead）**：`Executor.probe()` 现在在依赖检查通过后，用同一个 `sandbox-entry` 真正跑一次隔离 echo；失败即 `available=false`，standard 会走"未隔离执行"的审批路径，而不是先用假的 available 进入隔离再硬失败。本机自检通过；Windows 真机仍需验证 `listen EINVAL` 是否因此被正确识别。

#### 3.3 拒绝为什么不解释（B）

```js
// agent.mjs:208（所有非 shell 工具）
`[已取消] 用户未批准 ${name}。请说明为什么需要这次操作，或改用只读步骤。`
// sessions.mjs:171（只有 shell 路径在 c42f471 里补了解释）
`用户未批准执行，命令没有启动。需要批准的是：${...}。请说明原因、改用只读步骤，或让用户切换权限后重试。`
```

- 缺的是**结构化信息**：什么类别（external / shell / sensitive）、缺哪个域名、用户点了"拒绝"还是"5 分钟超时"、下一步能做什么。模型只能编一段解释。
- 5 分钟超时静默拒绝（`sessions.mjs:200`）：用户离开倒杯水，回来看到的是一句"用户未批准"，而**没人告诉他刚刚有个审批过期了**。

#### 3.4 审批复用粒度（B）

- `agent.mjs:207` 对**所有**浏览器/外部工具传 `canRemember: false` → UI 上永远没有"本对话允许相同动作"按钮（`ui/src/workspace.jsx:44` 只在 `req.canRemember` 时渲染）。
- 一次填表 3 个字段 = 3 次弹窗；`evaluate_script` 换个函数体 = 又一次（`scopeKey` 含 `args` 全量哈希，`agent.mjs:206`）。
- 唯一能 remember 的是隔离的 shell（`sessions.mjs:167` `canRemember: isolated`），而隔离在 macOS 上又跑不起来 → **用户几乎永远享受不到"记住"**。
- 审批期间页面 URL 一变就作废：`agent.mjs:209` 校验 `targetPage.url()`；SPA 自己改 hash / 用户切标签 → 审批直接取消，表现为"点了允许但还是失败"。

#### 3.5 networkDomains（B）

- 只有 `workspace_shell` 有 `networkDomains`（`sidecar/workspace.mjs:172`）；`workspace_run` / `workspace_npm` **没有**这个字段。写 Node 脚本扫描时，模型根本无法声明"我要访问哪些域"。
- 域名必须逐条精确（`sessions.mjs:163` 拒绝通配符），`strictAllowlist: true`（`sandbox-entry.mjs:26`）→ 几百个主机要么一次列几百条（审批框会显示整串域名），要么换个域就重新批。
- 隔离失败后（3.2），整条链直接退化为"必须 full-access"。

#### 影响

- 用户每次重启都要重新"争取"一次权限，同一个脚本在不同时间表现不同，无法建立稳定预期。
- 隔离失败让 standard 模式"看起来可用、实际不可执行"，用户只能全量放权——这是安全上的净损失，不是净收益。
- 逐次审批且不可记住，长表单/长流程被人为打断；审批期间页面 URL 一变还会误取消，用户会认为"点了允许也没用"。
- 网络白名单按域、且只有 shell 支持，扫描类任务无法声明意图，只能绕道 full-access 或本地脚本。

#### 修复设计

1. **权限持久化分级**：`mode` 增加 `remember` 语义（会话级持久 + 全局持久两档），或至少在 `stateNote` 里显式写"权限：standard（上次 full-access，应用重启后已降级，可一键恢复）"。**不允许静默降级**。
2. **拒绝返回结构化 payload**：
   ```json
   {"code":"APPROVAL_DENIED","category":"external","tool":"evaluate_script",
    "missing":["page:https://a.example"],"reason":"user_denied|timeout|scope_changed",
    "howToProceed":["让用户点击允许","切换到完全访问","改用只读 browser_snapshot"]}
   ```
   模型侧按 `code` 分支，而不是解析中文。
3. **可复用 grant**：把 `scopeKey` 从"参数全哈希"改成"动作 + 域/路径前缀 + 隔离级别"，例如 `net:GET:*.target.com`、`browser:fill:https://a.example`；`canRemember` 对浏览器动作开放，TTL 30 分钟，UI 文案"本会话允许该站点的填写"。
4. **networkDomains v2**：支持 `*.example.com`、`networkAppend`（在已批准集合上增量追加，不重新弹窗）、把 `network` 字段下沉到 `workspace_run`/`workspace_npm`/`run_node`；审批 UI 折叠显示为 `api.x.com 等 N 个域`。
5. **沙箱自检**：`probe()` 要做一次真实的 `initialize + wrap` 冒烟（spawn `true`），结果缓存并在设置页显示；运行时失败返回 `ISOLATION_UNAVAILABLE`，附带一个"以未隔离方式运行（需批准）"的显式降级选项（当前是硬拒绝，`executor.mjs:1-2` 的设计意图是对的，但需要产品化的出口）。
6. **超时提醒**：审批到期前 30 秒推一条 UI 通知；过期后 `pending` 保留 10 分钟可"补批准"。

#### 验收标准

- 重启应用后，对话首条 `stateNote` 里能看到权限变化说明；用户在 UI 点"恢复 full-access"后 `session-set-mode` 生效且落盘。
- 拒绝一次 `evaluate_script`，模型收到的 tool result 含 `code:"APPROVAL_DENIED"` 与 `missing` 数组（fixture 断言，不靠中文匹配）。
- 同一站点第二次 `browser_fill` 在 30 分钟内不再弹窗（e2e）。
- macOS 上 `probe()` 返回 `available:false` 时，UI 明确显示"隔离不可用"，且 standard 模式不再伪装成"可隔离执行"。
- 几百个域名的一次性扫描：一次审批覆盖整批 + 增量追加不再弹窗。

---

### 4. 后台任务 5 分钟无输出无法判断；offset 在中文/长输出下错位（P1）

**结论：确认。`c42f471` 加了 `time/out/err/tail`，但 offset 的根因没修。【A+B】**

#### 关键位置

```js
// sidecar/workspace.mjs:120-124（c42f471 之后）
function jobText(j) {
  const elapsed = ...;
  return `job ${j.id} ${state} pid=${j.pid || '-'} time=${elapsed}s out=${j.out.length}B ...\n${j.out}...`;
}
// sidecar/workspace.mjs:136-142
const body = jobText(j);
const offset = ...; const slice = body.slice(offset, offset + 20000);
return { text: `offset=${offset} next=${offset + slice.length} total=${body.length}\n${slice}` };
```

#### 根因（数据流层，三个叠加）

1. **offset 指向的是"每次重新拼出来的字符串"，不是稳定流**：
   - `body` 头部含 `time=${elapsed}s`，任务每过 1 秒长度就可能 +1 字符 → 上一次拿到的 `next` 下一次就偏 1；
   - `total` 也在变，模型无法区分"新增输出"和"窗口平移"。
2. **输出是滑动的尾部窗口**：`executor.mjs:48` `return full.slice(-MAX_OUTPUT)`（`MAX_OUTPUT=80000`）。超过 80KB 后头部被丢弃，`jobText` 里再插一句 `[输出已截断]`，offset 与内容彻底对不上。用户把这两件事一起描述成"中文乱码下错位"：**乱码来自第 3 条（解码），错位来自第 1、2 条（窗口与表头）**。中文不是根因，只是字节占比高、更早触发 80KB 截断。
3. **解码按 chunk 做、不跨块拼接**：`executor.mjs:48` `chunk.toString()`（UTF-8）。一个 3 字节汉字被切在两个 chunk 之间 → 两个 `U+FFFD`；`readWorkspace` 也一样（`workspace.mjs:48-52`：先 `toString('utf8')` 再 `.slice(0,max)`，可能切在字符中间）。

#### 影响

- 长任务（扫描、批量签名）的输出基本只能看个尾巴；模型为了拿全量反复 `offset` 翻页，越翻越乱。
- "5 分钟无输出"仍无法区分"在跑"与"卡死"：新增的 `time=` 只说明启动了多久，`out=NB` 只在有输出时变；没有 `lastOutputAt` / `idle` / 进程存活检查。
- 进程退出后 `status` 才变；后台任务在应用重启后从 `buckets`（内存 Map）消失，`workspace_job_output` 直接"没有这个后台任务"（`workspace.mjs:136`），而子进程可能还活着。

#### 修复设计

- `jobText` 拆成 `header` + `body` 两段，**offset 只对 body**；body 用 append-only 的字符串缓冲，保留绝对 `startOffset`（滑动窗口丢头时同时返回 `droppedBytes`）。
- offset 改**字节**语义（`byteOffset`），返回 `text` 时对齐到 UTF-8 字符边界；同时保留 `charOffset` 兼容旧调用。
- 心跳字段：`{status, startedAt, elapsedMs, lastOutputAt, silentMs, outBytes, alive, exitCode}`；`alive` 用 `process.kill(pid,0)`。
- 新增 `workspace_job_list`（id / cmd 摘要 / 状态 / 已跑时长 / 最后输出时间），并把 job 元数据落 `.jobs.json`；重启后能"认领"仍在跑的 pid。
- 沉默守卫：`silentMs > 300000` 时通过 `queueNotice` 给模型一条"job X 已静默 5 分钟，仍存活/已退出"。
- 解码统一用 `StringDecoder('utf8')` 按流拼接。

#### 验收标准

- 造一个每 200ms 输出一行的中文任务，跑 2 分钟：任意时刻 `offset` 续读**不重不漏**（拼接结果 == 全量 stdout）。
- 超过 80KB 后 `droppedBytes` 有值，且 `tail=true` 能拿到最后 20KB。
- 杀掉子进程后 `workspace_job_output` 在 1 次调用内返回 `alive:false`。
- 重启应用后 `workspace_job_list` 仍能看到历史 job（状态 `lost` 或 `running`）。

---

### 5. PowerShell + Tee/Select-String 输出 `�?`（P1）

**结论：确认（编码），`c42f471` 已加 UTF-8 前缀，但只解决了控制台编码的一半。【B】**
（本机是 macOS，无法真机验证 Windows；本条的实现判断为静态审查，标 **B/D**。）

#### 关键位置

```js
// sidecar/executor.mjs:32-38（修复后）
const prefix = '[Console]::OutputEncoding=[Text.Encoding]::UTF8; $OutputEncoding=[Text.Encoding]::UTF8; ';
return { file: ...powershell.exe, args: ['-NoLogo','-NoProfile','-NonInteractive','-Command', prefix + command] };
```

#### 根因

1. 旧版直接 `-Command <cmd>`，PowerShell 5.1 以**控制台代码页**（zh-CN 为 936/GBK）写 stdout；Node 侧 `chunk.toString()` 按 UTF-8 解码 → 一个 GBK 双字节字符变成 `U+FFFD`；再叠加控制台对不可表示字符的 `?` 替换，就显示成用户看到的 `�?`。
2. `Tee-Object -FilePath` 的**文件编码**与控制台编码是两件事：PS 5.1 的 `Tee-Object` 默认写 UTF-16LE（带 BOM）。模型随后用 `workspace_read`（按 UTF-8 读）读该文件 → 又一层乱码。这一条**没有修**。
3. 跨 chunk 切分多字节字符（见 §4 根因 3）在 PowerShell 大输出下同样发生。
4. `Select-String` 输出带颜色/进度条（`$ProgressPreference`）时还会混入 ANSI，进一步污染。

#### 影响

- Windows 用户"命令跑成功了，但输出读不懂"；长任务日志尤其致命，因为乱码处往往正是关键行。
- `Tee-Object` 落盘的文件在 `workspace_read` 里继续乱码，证据链断在最后一步。
- 跨 chunk 切字取决于管道缓冲时机，同一命令两次输出的乱码位置可能不同——这是"时好时坏"的另一个来源，且极难自查。

#### 修复设计

- shell 前缀补 `$ProgressPreference='SilentlyContinue'; $PSStyle.OutputRendering='PlainText'`（PS7）并 `chcp 65001 > $null`（PS5.1 兜底）。
- 在工具描述里明确：`Tee-Object -Encoding utf8`；或提供 `workspace_shell(encoding:'utf8')` 让宿主在读取时按 BOM 自动识别（`readWorkspace` 检测 `FF FE` / `FE FF` → `utf16le`/`utf16be`，返回 `encoding` 字段）。
- `executor.launch` 用 `StringDecoder` 拼流，禁止裸 `chunk.toString()`。
- 输出默认 `stripAnsi`（`NO_COLOR` 已加，但外部程序不一定遵守）。
- 给 `workspace_read` 加 `encoding:'auto'`，历史乱码文件至少能读。

#### 验收标准

- zh-CN Windows 真机：`Get-ChildItem | Select-String '中文' | Tee-Object out.txt` → 工具输出无 `�`，`workspace_read out.txt` 正常。
- 字节 fixture：把 GBK 字节流写进测试，断言解码为预期中文或明确报 `encoding:gbk`（而不是静默替换）。
- 1MB 输出中被 chunk 边界切开的汉字不出现 `U+FFFD`。

---

### 6. 目标 blocked / 等用户决策时仍被自动接续唤醒（P1）

**结论：部分确认。`blocked` 字面路径其实已被阻断；真正的漏洞是"自然语言提问"和"用户拒绝后的那一次接续"。【A+B】**

#### 已被阻断的部分（B）

- `updateGoal` 把 `blocked` 映射成 `needs_attention`（`goals.mjs:29`），并调用 `goalDriver.cancel()`（`sessions.mjs:442`）；
- `GoalDriver.schedule()` 只在 `status === 'active'` 时排程（`goals.mjs:49-58`）；
- `finishGoalRound` 在自动轮且 `hasWork === false` 时置 `needs_attention`（`goals.mjs:38`）。
  所以"模型显式 `goal_update(blocked)` → 继续被唤醒"在**当前代码里不成立**。用户看到的循环更可能是下面两条。

#### 真正的漏洞 1：文本提问不算"等待"（B）

`GoalDriver.idle()` 的条件是：没有运行中的 agent、没有队列、没有 pending 审批、**没有 pending 的 `ask_user`**（`sessions.mjs:75`）。模型如果只是**在回复里写**"你希望我用哪种方式？"，`askPending` 为空 → 上一轮 `stop==='completed'` → 目标仍 `active` → `.finally` 立刻 `goalDriver.schedule()`（`sessions.mjs:405`，延迟 300ms）→ 模型在没有用户回答的情况下继续干。

#### 真正的漏洞 2：用户拒绝后必有一次"整上下文重发"（B）

```js
// sessions.mjs:399
const status = this.permissionBlocked || [...] ? 'needs_attention' : result?.stop === 'completed' ? 'completed' : ...;
if (goalId && ... && this.goal.status === 'active' && (status !== 'completed' && result?.stop !== 'max-steps')) { ... }
```

- 用户拒绝审批 → 模型通常以文本收尾（`stop='completed'`）→ 上面这个条件**不成立** → goal 保持 `active` → `.finally` 排程一次自动接续。
- 自动轮里 `hasWork=false`（被拒的工具 `isError`，不算 work）→ 这一次之后才 `needs_attention`。
- 代价：**一次完整上下文的重新发送**。`default` 会话累计 22 万字符的工具输出，一次空转要把整个上下文重发一遍，成本可观。日志里 6 次 `continuation`（`e360/e419/e438/e463/e480/e575`）证明自动接续确实在跑；该构建未写 `source` 字段，无法据此区分是 goal 驱动还是旧版 auto 驱动（**D**）。

#### 其它不闭环的地方

- `ask_user` 超时 10 分钟返回空串（`sessions.mjs:224`），模型被告知"用户没回答，请自行判断" → 继续推进，目标仍 active。
- `goalContext()` 只在 `status==='active'` 时注入系统提示（`goals.mjs:42`）；一旦 `needs_attention`，模型连"目标是什么"都看不到了，却在历史里留着 `goal_update` 的调用记录。
- `restoreGoal` 把 `active` 一律改成 `paused`（`goals.mjs:8`），重启后必须用户手点"继续目标"，这个设计是对的，但对话里没有提示。

#### 影响

- 每一次用户可见的停顿（拒绝、提问、等待）都可能多烧一个完整上下文；本样本累计 22 万字符工具输出，重发一次的量级已经很高（具体 token 数未计，**D**）。
- 用户在等审批/等回答，却看到 Agent 又开工了——这比多花钱更伤信任。
- 如果自动轮里模型顺手做成了任意一次工具调用（`hasWork=true`），接续会继续，可能长时间空转。

#### 修复设计

1. 新增状态 `waiting_user`（`runs.mjs:5` 已经预留了这个枚举，但**全仓库没有任何地方写入它**，见 §10）：`ask_user` 挂起时 `runs.status(run,'waiting_user')`；模型以疑问句收尾且目标 active 时，也置 `waiting_user`。
2. `GoalDriver.schedule()` 增加门禁：`goal.status==='active' && !waitingUser && !pendingApproval`；`waiting_user` 只能由用户输入解除。
3. 拒绝后：`.then` 里把 `permissionBlocked` 也视为"非 completed"，直接 `needs_attention`，**不排下一次接续**。
4. 连续自动接续加闸：`maxAutoContinuations`（默认 3）与 `noProgressRounds`（连续 2 轮无新工具成功即停）；UI 显示"已自动接续 N 次 / 消耗 X tokens"。
5. `goalContext` 在 `needs_attention` 时也注入一行"目标已暂停，原因：等待用户批准 X"，让模型能解释而不是乱猜。

#### 验收标准

- 假 provider 测试：模型回复"请选择 A/B"后，`GoalDriver` 不触发第二次调用；用户回复后才继续。
- 用户拒绝一次工具审批 → 该轮结束即 `needs_attention`，`turn-end` 之后没有新的 `run-started`。
- 连续 3 次自动接续无新成功工具 → 自动暂停并给 UI 原因。
- `runs.status` 能观察到 `waiting_user` 的进入/退出。

---

### 7. 子代理只能读文件 + 推理、不能发 HTTP、结论被截断（P1）

**结论：确认，而且比用户描述的更严重——样本里 5/5 子代理全部 `limited`。【A+B】**

#### 关键位置

```js
// sidecar/subagents.mjs:8
const READ_TOOLS = new Set(['workspace_list','workspace_read','workspace_grep']);
// :18  只挂这三个工具，browser:null，mcp 为空
// :19  maxTokens: Math.min(2500, ...)
// :26  5 分钟硬超时
// :27  maxSteps:10, tokenBudget:Math.min(40000, ...)
// :29  record.summary = answer.slice(0, 18000)
```

#### 证据（A）

- `default/.subagents.json` 4 条 + `s699…/.subagents.json` 1 条，**全部 `status:"limited"`**，摘要开头分别是"任务未完成""因触达预算上限被要求停止"。
- 结论长度 3370–5014 字符，而 `agent_wait` 的返回会走 `trimToolOutput`（默认 `limit:6000, head:1800`，`context.mjs:177`）。**超过 6000 字符的结论，父代理只能看到前 1800 字符 + 一个 ctx_ref**，必须自己 `context_ref_read` 分页——正是用户说的"需要主代理二次分页"。
- 子代理没有 `http_*`，也没有浏览器，所以"某接口是否真的返回 200/某算法是否产出正确签名"这类**可验证结论**它给不出，只能给"我认为"。

#### 根因（能力边界 + 预算模型）

1. 子代理被定位成"只读研究工作区"，但用户的真实任务有一半是**网页/接口验证**，工作区里没有证据。
2. 预算三连（2500 输出 / 40k token / 10 步）对"读一个 3000 行 bundle 再总结"根本不够，必然 `limited`；`limited` 的结论又是**半成品**，父代理还得重做。
3. 结论走"最后一条 assistant 文本"（`:28`），没有结构化字段（已完成/未完成/证据路径），父代理无法判断可信度。

#### 修复设计

- **能力档位**：`agent_spawn({profile:'reader'|'web'|'verify'})`；`web` 档给 `http_get`（域名 allowlist 来自父代理的 grant，只读 GET/HEAD，响应落盘到工作区 `subagents/<id>/`），不给浏览器（避免共享 debugger/登录态）。
- **预算可配**：`agent_spawn({maxSteps, tokenBudget, maxOutputTokens})`，默认提到 20 步 / 120k / 8k；`limited` 时自动落盘完整报告并返回 `{status:'limited', reportPath}`，父代理读文件而不是被 6k 截断。
- **结构化结论**：record 增加 `{done:boolean, evidence:[{type:'http'|'file', ref}], openQuestions:[], reportPath, sections:[{title, chars}]}`；`agent_wait` 默认只回 `summary + sections 目录`，需要细节用 `agent_result(id, section)`。
- **可验证性**：子代理每给一个结论，必须附 `evidence` 条目；父代理侧做一个 `verify_subagent(id)`，抽 1–2 条证据复跑。

#### 验收标准

- 同一"读 bundle 找签名函数"任务，5 个子代理至少 4 个 `completed`（当前 0/5）。
- 结论 8000 字符时，父代理一次 `agent_wait` 能拿到目录 + 完整报告路径，不需要 `context_ref_read` 翻页。
- `web` 档子代理能对 allowlist 内的 URL 发 GET，越界域名返回结构化拒绝。

---

### 8. 没有 upload_file；take_screenshot 不说明产物路径（P0）

**结论：确认。本轮曾加的 `browser_upload` 在真实对象上直接抛 TypeError，比"没有"更糟；该工具已移除，等待组件侧实现。【A+B+C】**

#### 8.1 截图：路径问题的真相（B）

```js
// 内核 src/vendor/core-build/src/tools/screenshot.js:57-90
if (request.params.filePath) { saveFile(...); "Saved screenshot to <path>." }
else if (screenshot.length >= 2_000_000) { saveTemporaryFile(...); "Saved screenshot to <path>." }
else { response.attachImage({...});  // ← 只回图片，没有路径
       setStructuredContent({attached:true}) }
```

- 不传 `filePath` 且图不大 → **只 attach 图片**，没有路径。
- 而宿主桥接层**只保留 text part**：`sidecar/browser.mjs:181` `.filter(p => p.type === 'text')`。图片被静默丢掉，模型只看到"Took a screenshot of the current page."——既看不到图，也没有路径。
- 这不止影响截图：**任何返回图片的 MCP 工具（含外部 MCP）在这套链路上都不可用**。多模态工具结果在架构上是缺失的，不是某个工具的 bug。
- `c42f471` 在 system prompt 里加了"先 `take_screenshot(filePath=工作区路径)`"的指引，方向对；但 `take_screenshot` 属于 debugger 分组（要 `discover_tools(debugger)` 才有），prompt 里没提这一点，模型会在没有该工具时瞎试。

#### 8.2 上传：曾加的工具是坏的，已移除（**C，已复现**）

```js
// sidecar/browsertools.mjs:22
await page.locator(args.selector).setInputFiles(file, { timeout: 15000 });
```

`ctx.browser.activePage` 不是 Playwright 的 Page，而是 `BrowserManager` 自己的轻量代理：

```js
// sidecar/browser.mjs:59-70
page = { id, info, closed, url(), isClosed(), title() };   // 没有 locator / goto / setInputFiles
```

本机只读复现：

```
$ node -e "... new BrowserManager(); updateStatus({pages:[...]}); tool.run({selector,path:'package.json'}, ctx)"
THREW: TypeError page.locator is not a function
```

- 在 agent 循环里会被 `runToolBatch` 的 catch 变成 `[工具错误] page.locator is not a function`（`agent.mjs:368-372` 附近）。
- 它的单测为什么过？原测试里造了一个**假的** `page = { isClosed, locator: () => ({ setInputFiles }) }`，测试替身与生产对象契约不一致，**测试给了假安全感**；该测试已随工具一起移除。
- 正确做法：上传必须在**组件进程**里执行（那里才有真的 Playwright Page），例如给 `wdh_control` 加 `upload` action，或在内核暴露 `upload_file(selector, paths)` 工具（`setInputFiles`），宿主只做路径校验与审批。

#### 8.3 还缺的语义

- 多文件、目录上传、`<input multiple>`；
- 隐藏 input（`display:none`）需要 `setInputFiles` 而不是 click；
- 上传后的等待语义（`waitForFileChooser` / 进度 / 服务端校验）；
- 从剪贴板/拖拽上传；
- 截图默认落盘到 `workspace/.artifacts/` 并返回相对路径（当前完全依赖模型自觉传 `filePath`）。

#### 影响

- 需要上传的表单（证件、日志、截图、导出文件）100% 要人接手，Agent 的"端到端"承诺在最后一步断掉。
- 截图既看不见也拿不到路径 → 模型无法自检表单填得对不对、验证码过没过、布局有没有遮挡。
- 新加的 `browser_upload` 直接抛 TypeError，模型会归因为"选择器不对"并反复重试，浪费步数且污染失败统计。

#### 修复设计

1. **重新实现上传（当前已移除）**：宿主只校验 `workspacePath` + 审批，实际 `setInputFiles` 交给组件（新增 `wdh_control('upload', {selector, files})` 或内核工具）；返回 `{selector, files, inputAccept, multiple}`。
2. **截图一律返回路径**：宿主在调用 `take_screenshot` 时自动补 `filePath = .artifacts/shot-<ts>.png`（除非显式传），并把 `Saved screenshot to ...` 归一化成 `{path, bytes, width, height}`。
3. **多模态工具结果**：`browser.mjs:181` 保留 `image` part，转成可在 `wire()` 里挂到 tool 消息上的 `_images`（`context.mjs` 已有图片通道，只差把 tool 结果接进去）；不支持视觉的模型则自动降级为"已保存到 path"。
4. 把 `take_screenshot` 从 debugger 组移到 core/browser 组（它是观察工具，不是调试工具）。

#### 验收标准

- e2e：一个带 `<input type=file>` 的表单，`browser_upload` 后服务端确实收到文件（不是只断言 `setInputFiles` 被调用）。
- 单测里**用真实的 `BrowserManager` 页面代理**跑一遍，断言"不支持的操作返回结构化错误而不是 TypeError"。
- `take_screenshot` 无参调用也返回 `path`；开启视觉的模型能在下一条消息里"看到"图。
- `.artifacts/` 有保留策略（见 §E5）。

---

### 9. skill/memory 索引为空，长任务结论不沉淀（P2）

**结论：确认，是产品缺口而不是 bug。【B】**

#### 关键位置

- `sidecar/extensions.mjs:68-71` `index()` 只列已存在的 `skill`/`memory` 文件；空目录就是 `{"skills":[],"memories":[],"skillCount":0,"memoryCount":0}`。
- `agent.mjs:302` 把这段 JSON 拼进 `stateNote`，**每轮都提醒模型"有索引"**，但没有任何自动写入。
- 没有任何"任务结束→生成记忆/技能草稿"的钩子：`finishGoalRound`（`goals.mjs:31-40`）只改状态，不落文件；`turn-end` 也没有。

#### 影响（长跑尤其明显）

- 换会话 = 从零开始：`default` 会话花了 101 步摸清小红书的容器格式，下一个会话没有任何入口能读到这些结论。
- 用户的"换会话从零开始"不是模型忘了，是**产品没有交付物**：结论只存在于 `.agent-history.json` 的 assistant 文本里，既不结构化也不可检索。
- 更隐蔽的是：`stateNote` 每轮说"有技能和记忆索引"，模型可能去调用 `skill_manage(list)`，得到空列表，浪费一步。

#### 修复设计

1. **项目简报（project brief）**：`<project>/.agent/BRIEF.md`，在一轮结束（或 goal complete）时由模型用 `brief_update` 维护（`{goal, findings[], evidence[], openQuestions[], nextSteps[]}`），`stateNote` 注入 2KB 摘要。这是"跨会话状态"的最小可用形态。
2. **自动沉淀提议**：turn-end 时若本轮 ≥N 次工具调用且产出结论，UI 弹一张卡"把这次结论存为项目技能？"（默认询问，可设为自动/关闭）。写入 `skill_manage(scope:'project')`。
3. **索引非空引导**：`index()` 为 0 时返回一句 `hint:"尚无技能；任务完成后可用 skill_manage(write) 保存可复用流程"`，避免模型空转。
4. **内置技能包**：随应用带 3–5 个（网页扫描、表单提交、debugger 排障、签名定位），`index()` 一开始就不为空。
5. **可检索**：`session-search` 已有（`index.mjs:150`），把"结论摘要"也纳入索引，下一会话能搜到。

#### 验收标准

- 新会话第一轮 `stateNote` 含上一次同项目任务的 3 条结论（来自 BRIEF）。
- 长任务结束后 UI 出现沉淀卡片；接受后 `skill_manage(list)` 非空。
- 内置技能在全新安装时 `skillCount >= 3`。

---

### 10. 没有结构化状态；goal_update 报错与事实不符（P1）

**结论：部分确认。报错文案已在 `c42f471` 修好；"模型看不到结构化状态"仍然成立，而且 `waiting_user` 这个状态从来没有被写入过。【B】**

#### 10.1 goal_update 的旧报错（已修，B）

```js
// 旧：三种完全不同的原因共用一句话
if (!this.goal || this.goal.status !== 'active' || this.activeRun?.source !== 'goal')
  throw new Error('只有用户通过 /goal 启动的当前目标可以更新');
```

三种真实原因：① 根本没有目标；② 目标被暂停/需要处理（例如应用重启后 `restoreGoal` 把 active 改成 paused，`goals.mjs:8`）；③ 当前这轮不是 goal 轮次（例如自动化任务里）。旧文案把三者都说成"你没用 /goal"，与事实不符——用户就是从 UI 启动的目标。

`c42f471` 已拆成三条精确文案（`sessions.mjs:436-441`），这条算修好；剩下的问题是**模型仍然不知道当前处于哪个状态**。

#### 10.2 结构化状态缺失（B）

- `stateNote()`（`agent.mjs:293-315`）只有：页面 URL / 抓包条数 / 工作目录 / 权限 / AGENTS.md / 项目目录 / 扩展索引 / todos。**没有**：待审批、待回答、后台 job、子代理、目标状态、预算余量。
- `publicState()`（`sessions.mjs:120`）有 `approvals/questions/goal/subagents`，但那是给 UI 的，模型拿不到。
- `RunStore` 定义了 `waiting_user`（`runs.mjs:5`），但全仓库**只有 `waiting_approval` 被写入**（`sessions.mjs:206`）；`waiting_user` 是死枚举。
- `goalContext` 只在 active 时注入（`goals.mjs:42`）→ 目标一暂停，模型连"我在为哪个目标工作"都看不到，却还被要求 `goal_update`。

#### 影响

- 模型无法回答"现在卡在哪、在等谁"；用户问"现在啥情况"（日志里真实出现过），模型只能翻历史猜。
- 长任务恢复时，模型不知道上次是被拒绝、被暂停、还是任务还在后台跑。
- UI 和模型对状态的认知不一致，导致"用户以为在等审批，模型以为在等工作"。

#### 修复设计

1. **`state_get` 工具**（只读，零副作用）：
   ```json
   {"phase":"waiting_approval","mode":"standard","review":"manual",
    "pending":{"approvals":[{"id","tool","category","summary"}],"question":{...}},
    "jobs":[{"id","status","elapsedMs","silentMs"}],
    "subagents":[{"id","status","title"}],
    "goal":{"id","status","nextAction","revision","usedTokens"},
    "browser":{"tabs":2,"active":"https://...","paused":false},
    "budget":{"contextUsed":123456,"contextLimit":1000000,"step":12,"maxSteps":0}}
   ```
2. **每步注入精简版**（≤400 字符）到 `stateNote`：`phase / 待审批数 / job 数 / goal 状态 / 预算%`。这是"模型有眼睛"的最低成本做法。
3. **状态机补全**：`ask_user` → `waiting_user`；审批 → `waiting_approval`；job 全静默且无 pending → `running_silent`；goal 暂停 → `paused(reason)`。`runs.mjs` 的枚举直接复用。
4. **目标暂停也注入 goalContext**（一行原因），并在 `goal_update` 的错误里带 `currentStatus`。
5. UI 增加一个"扫描中 / 待审批提交 / 待授权"的徽章（`ui/src/chat.jsx:168` 已有 `waiting_approval/waiting_user` 文案，但没有数据源）。

#### 验收标准

- 模型在任意时刻调用 `state_get` 能得到上面这些字段，且与 UI 显示一致（同一 fixture 断言两边）。
- `ask_user` 挂起时 `run.status === 'waiting_user'`，回答后回到 `running`。
- 目标暂停后，`stateNote` 含"目标已暂停：等待用户批准 evaluate_script"。
- 用户问"现在什么情况"，模型无需读历史即可回答。

---

## 二、用户没提、但长期使用一定会踩的 5 个缺陷

### E1. 沙箱探针说"可用"，真实执行 100% 失败（P0）

- **证据**：`node sidecar/sandbox-entry.mjs --probe` → `{"available":true}`（C）；真实会话 10 次执行失败，均为 `[执行隔离失败，未降级运行] listen EINVAL`（A；`s699`×7 / `sa2e`×2 / `default`×1，另有 1 条 `job_output` 回显同一 stderr）。
- **根因**：`probe()` 只查依赖（`sandbox-entry.mjs:9-11`），不跑 `initialize()+wrap`；`sessions.mjs:164` 据此判定 `isolated=true`，然后每次都失败。`executor.mjs:1-2` 明确"隔离失败不自动降级"，于是 standard 模式等于不可执行。
- **影响**：这是"审批横跳"的隐藏推手——用户被迫切 full-access，而 full-access 不落盘（§3.1）。它也是 `workspace_shell` 28/172 错误率的主要来源之一（其余是非零退出码被当成工具错误，见附录 B）。
- **设计**：probe 做真实冒烟并缓存；失败时返回 `ISOLATION_UNAVAILABLE` + UI 一键"未隔离运行（需批准）"；设置页显示隔离健康状态。
- **验收**：macOS/Windows 各一台机器，`probe()` 的结论与真实 `initialize` 一致；不一致时 standard 模式不再假装可隔离。

### E2. 子代理会在父轮次结束时被静默取消（P1，**D**）

- **代码**：`sessions.mjs:402` `.finally(() => { ...; this.subagents.cancelRun(run.id); })`，而 `cancelRun` 会取消所有 `parentRunId === run.id` 的子代理（`subagents.mjs:94`）。
- **矛盾**：`agent_spawn` 的文案是"完成时主代理会自动收到通知"（`harnesstools.mjs:4`），`subagentSettled` 也确实准备了通知（`sessions.mjs:244-251`）——但父轮次一结束，还在跑的子代理先被杀了。
- **为什么没在日志里爆**：样本里父代理都用了 `agent_wait` 等结果，轮次没提前结束。**这是推断（D）**，但只要父代理选择"先结束这轮、稍后收结果"，子代理必死。
- **设计**：子代理生命周期跟随会话而不是轮次；`cancelRun` 只在会话关闭/用户停止时调用；或者显式 `detached:true` 语义。
- **验收**：父代理结束轮次后 30 秒，子代理仍 `running` 并能正常 `onSettled` 通知。

### E3. 工具可用性与浏览器/MCP 生命周期脱节（P1，**A+B**）

- **现象**：`e159`、`e163` 两次 `evaluate_script` 得到"工具未启用或不可用，请先 discover_tools"，而历史里上一轮刚用过；`e103/e107/e113` 三次"调试器连接已断开"，两次 `discover_tools` 都没救回来。
- **根因（三重）**：
  1. `Agent.groups` 是内存 `Set`（`agent.mjs:70`），**不持久化**；重启/重开浏览器后模型"记得自己启用过"，代码不记得。
  2. `McpBridge.stop()` 清空 `tools`（`sidecar/mcp.mjs:28-32`），但 `groups` 仍是 `debugger` → `allTools()` 拼出空列表 → 报"未启用"。
  3. `ensureDebugger()` 的短路条件用的是宿主侧 `mcp.client`（永远真）而不是内层桥的存活状态（`sessions.mjs:311`）→ `discover_tools` 变 no-op，内核死了也不会重启。
- **影响**：模型得到"去 discover_tools"的错误建议，照做无效，最后放弃该能力（日志里就是放弃 evaluate）。
- **设计**：工具可用性 = `groups ∩ 实际 tools`，并在 `stateNote` 里显式列出当前可用组；`ensureDebugger` 改用内层 `client` 存活 + generation；`discover_tools` 失败时返回可执行的下一步（"请先 browser_open"）；groups 落 `.agent-state.json`。
- **验收**：关浏览器→重开→`evaluate_script` 无需 discover 直接可用；杀内核进程后一次 `discover_tools` 恢复。

### E4. 每次 append 全量重写 + fsync，长会话线性变慢（P2，**C**）

- **代码**：`agent.mjs:80` `hist.onAppend = () => this.persist()` → `History.save` → `atomicJson`（`paths.mjs:55-60`，`writeFileSync + fsyncSync + rename`）；`RunStore.event` 同样是 journal append + 全量 `save()` 双写（`runs.mjs:27-30`）。
- **实测**：1.14MB / 591 事件，单次 `stringify + write + fsync` **8.65ms**；一次工具调用至少 2 次 append（assistant + tool）。10MB 会话按线性估算 ~75ms/次，且都在 sidecar 主线程上——直接卡住流式输出与 UI RPC。
- **影响**：长任务越跑越卡，用户感知为"越用越慢"，而不是某个功能坏。
- **设计**：事件日志改 append-only（`.jsonl`，`fs.writeSync` 追加，不 fsync 每条）；快照按 5s 防抖 + 退出时强制落盘；`restore()` 时 jsonl 回放 + 快照校验（`runs.mjs` 已经有这个模式的雏形，可复用）。
- **验收**：10 万事件会话，append P95 < 2ms；重启后事件不丢（kill -9 测试）。

### E5. 磁盘无保留策略：单会话抓包 111–121MB（P2，**A**）

- **实测**：`default/.capture` 111MB、`s7e8…/.capture` 121MB、`s699…` 8.8MB；`.ctx` 引用文件只增不删；`.chats` 归档只增不删；`MAX_SESSIONS=100`（`sessions.mjs:29`）。
- **代码**：桌面侧没有任何 `.capture` 配额/清理逻辑（只有 `clear-requests` 清记录，是否删 body 文件由组件决定，未验证）；`trimToolOutput` 写 `.ctx/ctx_*.txt` 后无 GC（`context.mjs:177-190`）。
- **影响**：长期使用几个 GB 起步；备份/同步变慢；用户不敢删（怕是证据）。
- **设计**：每会话 capture 上限（默认 2GB，LRU 淘汰最旧 body）+ 全局上限；`.ctx` 按 7 天/100MB 清理并在 `context_ref_read` 失败时给出明确"已过期"；UI 显示占用并可一键清理；`export_har` 后再清理。
- **验收**：连续 20 个长会话后占用 < 阈值；清理不影响正在运行的任务。

---

## 三、案例复盘（失败是怎么传播的）

### 案例 A：debugger 暂停死锁（会话 `s7e8…`，76 步）

```
用户：搜索武汉的健身房，文化大道
A1  browser_open(baidu)                     ✅
A3  browser_open(wappass 验证码页)           ← 触发反爬
A10 browser_fill(input#kw)                  ❌ 15s 超时：element is not visible
A12 evaluate_script                          ✅ 读到页面标题
A13 browser_open(map.baidu.com)              ✅
A19~A26 在 bing/sogou/360/amap 之间反复 browser_open（单标签，来回覆盖）
A27 evaluate_script                          ❌ Can only perform operation while paused   ← 死锁起点
A28 browser_snapshot                         ❌ 被 paused() 拒绝
A29 get_paused_info                          ✅ 说"已暂停"（栈在 360 的 quc7.js —— 页面自己的 debugger 语句）
A30 resume                                   ❌ CDP_ERROR
A34 list_breakpoints                         ✅ "没有断点"（证明不是我们下的）
A35 pause                                    ❌ CONFLICT already paused
A36 resume                                   ❌ CDP_ERROR（同一个错）
A40 step                                     ❌ CDP_ERROR
A42 evaluate_script                          ❌ 同一个错
A46 evaluate_script                          ❌ 调试器连接已断开
A47 discover_tools(debugger)                 ⚠️ 返回旧列表，什么也没重建
A51 evaluate_script                          ❌ 仍然断开 → 模型放弃调试器
```

**传播链**：页面自身 `debugger` → `paused` 缓存置真 → 导航丢弃暂停但没补 `resumed` → 缓存与 CDP 会话分裂 → `evaluate` 走 callFrame 路径失败 → `snapshot` 读缓存拒绝 → `resume` 读缓存放行但 CDP 拒绝 → 无恢复工具 → 连接断开后 `discover_tools` 是 no-op → **能力永久丢失，直到用户换页/重启**。

**代价**：25 个决策步、26 次工具调用、约 3 分钟；最终结论质量下降（只靠 snapshot 文本拼答案）。

### 案例 B：多目标长跑扫描（会话 `default`，101 步）

```
用户：分析小红书的 X-S 参数，要完整纯算法
A1~A20   workspace_shell ×N  → 一半以上返回 [执行隔离失败，未降级运行] listen EINVAL
         → 用户切 full-access → 能跑
（期间） context 从未压缩（无 summary 事件），history 长到 1.14MB
A~55     agent_spawn ×4 → 全部 limited（40k token 用尽）
e556    主代理调用不存在的工具名 write_file → 工具未启用（工具表里叫 workspace_write）
e157 用户：这很难，工作量很大，所以你需要持续处理，不要停下来
e159 evaluate_script → 工具未启用（浏览器已关，groups 残留 / tools 清空）
e360/e419/e438/e463/e480/e575  6 次自动接续，每次重新"核对第 N 项"
最终：X-S 外层容器解出，x3 核心签名未解
```

**传播链**：隔离失效 → 被迫 full-access → 重启降级 → 再失败 → 用子代理分担 → 子代理预算不足全 limited → 结论半成品 → 主代理反复重读上下文（无压缩、无简报）→ 自动接续继续烧 → 最终交付不完整。

**这条链里没有一处是"模型不会"**，全是产品层：执行可用性、预算、状态、沉淀。

### 案例 C：表单 + 附件提交（会话 `s7e8…` 前 30 步 + 代码路径）

```
A1/A3  browser_open → 先百度首页，再跳 wappass 滑块验证页（反爬）
A4     browser_snapshot → 只能看到验证码 iframe
A5     browser_open(baidu 首页) 重新来
A6     browser_fill(input#kw) → 15s 超时：element is not visible（页面其实不是首页）
A9     evaluate_script → 读到真实标题，确认还在验证页
A10    browser_fill → 这次成功
A11    browser_press(Enter) → 提交后又被弹回验证码
A12    evaluate_script → URL 已是 wappass
...（后面每次想"填表"都要先 browser_open，因为只有一个标签）
```

到了"上传附件"这一步，**根本没有工具**：旧版 60 个工具里没有 `upload_file`；`take_screenshot` 只回图片不留路径，而图片在 `browser.mjs:181` 被丢掉 → 模型既拿不到文件也看不到页面。`c42f471` 补的 `browser_upload` 在真实对象上 `TypeError`（§8.2）。

**传播链**：反爬 → 需要保留表单页去另一页取验证信息 → 无 new_tab（只能覆盖）→ 覆盖后状态丢失 → 重填 → 需要上传 → 无工具/工具坏 → 用户手工完成。这正是"Agent 看起来能干活，但最后一步永远要人接手"的典型。

---

## 四、4 周路线图

> 原则：先修"能力会永久丢失"的（P0），再修"每次都要人多点几下"的（P1），最后做"越用越值钱"的（P2）。
> 每周留 1 天做回归与真机验证。

### 第 1 周：P0 止血（能力不能丢）

| 任务 | 交付 | 验收 |
|---|---|---|
| 调试器状态对账 + `debugger_recover` | 内核 `DebuggerContext` 监听导航/上下文清空；resume 幂等；新工具 | 案例 A 回放通过；`s7e8` 日志 fixture 无 `Can only perform operation while paused` |
| `browser_snapshot` 不再被坏标志否决 | 暂停时降级返回 | paused 页面仍能读 DOM |
| 修 `browser_upload` | 走组件 `setInputFiles`；单测用真实页面代理 | e2e 表单上传成功 |
| 截图默认落盘 + 返回路径 | 宿主补 `filePath`；结果归一化 | 无参调用也返回 path |
| 隔离探针真实化 + `ISOLATION_UNAVAILABLE` | probe 冒烟；错误码；UI 降级入口 | macOS/Windows 探针与真实执行一致 |

### 第 2 周：P0/P1 授权与可观测

| 任务 | 交付 | 验收 |
|---|---|---|
| 权限不再静默降级 | `stateNote` 提示 + 一键恢复 + 可选持久化 | 重启后模型知道权限变了 |
| 结构化拒绝 + 可复用 grant | `APPROVAL_DENIED` payload；站点级 remember（TTL 30min） | 同站第二次 fill 不弹窗 |
| networkDomains v2 | 通配、增量、下沉到 run/npm | 几百个域的扫描一次批准 |
| 任务可观测 v2 | 稳定 offset、字节语义、`job_list`、沉默通知、重启认领 | 2 分钟中文输出续读不重不漏 |
| PowerShell 编码收尾 | `StringDecoder`、`Tee-Object` 文件编码、`workspace_read` 自动识别 | zh-CN 真机验收 |

### 第 3 周：P1 状态与子代理

| 任务 | 交付 | 验收 |
|---|---|---|
| `state_get` + 每步状态注入 | phase/审批/job/goal/预算等核心字段；`waiting_user` 落地 | 模型能回答"现在等谁" |
| 自动接续闸门 | `waiting_user`/审批/拒绝阻断；`maxAutoContinuations` | 拒绝后不再自动跑一轮 |
| 子代理能力档 + 预算可配 + 结构化结论 | `profile`、`reportPath`、`sections` | 4/5 completed |
| 工具可用性生命周期 | groups 持久化；`ensureDebugger` 看内层存活；错误给下一步 | 关浏览器重开无需 discover |
| 工具注册表清理 | 删/标 68 个幽灵工具；`discover_tools` 带一行描述 | 无 `write_file` 类幻觉 |

### 第 4 周：P2 沉淀与体验

| 任务 | 交付 | 验收 |
|---|---|---|
| 项目简报 + 自动沉淀 | `brief_update`、turn-end 沉淀卡片、内置技能 | 新会话带入 3 条结论 |
| 持久化性能 | append-only jsonl + 防抖快照 | P95 < 2ms |
| 磁盘保留 | capture/.ctx 配额 + UI 清理 | 20 会话 < 阈值 |
| 多模态工具结果 | image part 贯通到 `wire()` | 截图能被"看到" |
| 回归基线 | 3 个真实案例做成回放 fixture + 指标看板 | CI 里能跑 |

---

## 五、需要产品决策的点

1. **full-access 要不要跨重启保留？** 保留=体验好但风险高；不保留=必须显式提示"已降级"，否则就是用户说的"横跳"。建议：会话内保留 + 重启后横幅提示 + 一键恢复（不做静默）。
2. **隔离失败时允不允许"降级未隔离"？** 当前硬拒绝（安全正确，但产品不可用）。建议：默认拒绝 + 一次性显式批准 + 在 UI 标红"本次未隔离"。
3. **子代理能否联网？** 只读 GET + allowlist + 结果落盘，是"能验证"和"能外联"的中间态。建议开，但域名必须由父代理的 grant 派生，且默认关闭 POST。
4. **审批记忆的粒度与时长**：站点级 30 分钟？项目级？"本任务允许"和"本会话允许"要不要分开？这直接决定弹窗次数。
5. **自动接续的预算与告知**：连续 N 次无进展就停？要不要在对话里显式插入"自动接续 #3（消耗 12 万 token）"？建议要，用户对"烧 token"的感知来自不可见。
6. **截图/图片要不要进模型上下文？** 成本（token）vs 能力（验证表单、看验证码）。建议：默认进，可在设置里关；不进时必须给路径。
7. **磁盘保留策略**：抓包 body 保留几天/多大？删之前要不要提示导出 HAR？建议默认 7 天 / 2GB，先提示后清理。
8. **结论自动沉淀的默认值**：询问 / 自动 / 关闭。涉及隐私（结论可能含目标站点信息），建议默认"询问"。

---

## 六、附录

### A. 复现命令（全部只读，可重跑）

```bash
# 1) 全量单测
node --test --test-concurrency=2 sidecar/test/*.test.mjs      # 293 tests / 290 pass / 3 skip

# 2) 隔离探针（说"可用"，但真实 initialize 会 EINVAL）
node sidecar/sandbox-entry.mjs --probe
# → {"available":true,"errors":[],"warnings":[]}

# 3) browser_upload 在真实页面代理上抛错
node -e "Promise.all([import('./sidecar/browsertools.mjs'),import('./sidecar/browser.mjs')])
 .then(async ([{BROWSER_TOOLS},{BrowserManager}])=>{
   const b=new BrowserManager({});
   b.updateStatus({running:true,pages:[{index:0,id:'p1',url:'https://example.com',active:true}]});
   const t=BROWSER_TOOLS.find(x=>x.name==='browser_upload');
   try{ console.log(await t.run({selector:'input[type=file]',path:'package.json'},
        {browser:b,workRoot:process.cwd(),workspaceId:'w',projectId:'p'})); }
   catch(e){ console.log('THREW:', e.message); } });"
# → THREW: page.locator is not a function

# 4) 持久化成本（1.14MB 历史）
node -e "const fs=require('fs');const o=JSON.parse(fs.readFileSync(
 '.tmp/macos-dev/fresh-backup-20261030-232332/projects/default/.agent-history.json','utf8'));
 let s=process.hrtime.bigint();for(let i=0;i<20;i++)JSON.stringify(o);
 console.log('stringify ms',Number(process.hrtime.bigint()-s)/1e6/20);"
# → ~2.87ms stringify；含 fsync 的写入实测 8.65ms
```

会话日志位置（只读样本，来自 2026-10-30 的备份构建）：

```
.tmp/macos-dev/fresh-backup-20261030-232332/projects/<session>/.agent-history.json
.tmp/macos-dev/fresh-backup-20261030-232332/projects/<session>/.subagents.json
.tmp/macos-dev/fresh-backup-20261030-232332/projects/<session>/.agent-state.json
```

### B. 其它已核实、未单列的风险

| 风险 | 证据 | 影响 | 建议 |
|---|---|---|---|
| 切工作区杀后台任务 + 清空本会话授权 | `sessions.mjs:153` | 长扫描切项目=前功尽弃 | job 按 workspace 归属，不随会话切 |
| 切换权限（空闲时）同样杀 job + 拒绝所有 pending | `sessions.mjs:103-104` | 点一下权限下拉，任务没了 | 只在 running 时保留 pending，空闲时提示确认 |
| 审批 5 分钟静默过期 | `sessions.mjs:200` | 用户离开一会，命令被拒且无告知 | 过期前通知 + 保留 10 分钟可补批 |
| pending 审批/提问不落盘 | `saveState` 字段（`sessions.mjs:93`） | 重启后不知道上次卡在哪 | 写入 state，UI 显示"上次在等你回答" |
| 68/104 个策略工具名不在本地注册表 | `policy.mjs` CLASSIFIED（104 项）vs `DEFAULT_TOOLS`（36 项，C） | 一部分是 WDH 内核工具（合理），一部分是遗留/被 `HIDDEN` 的（如 `select_page`）；模型幻觉 `write_file` 只能得到"未启用" | 清理策略表；未知工具名给"你是不是想 workspace_write" |
| `discover_tools` 只回名字，不回描述 | 日志 `e27` 一行 60 个名字 | 模型靠猜参数 | 回 `name — 一行描述`，或分组分页 |
| 目标暂停后不再注入 goalContext | `goals.mjs:42` | 模型看不见目标却要更新 | 暂停也注入原因 |
| `RunStore` 每次事件双写 + fsync | `runs.mjs:27-30` | 与 §E4 叠加 | 合并到同一 append-only 日志 |
| 非零退出码被当成"工具错误" | `workspace.mjs:133` `isError: job.code !== 0` | `grep` 没匹配、测试失败等正常结果进入失败统计与 `repeatedFailures` 判重 | 区分 `tool_error` 与 `nonzero_exit`，后者不参与"连续失败"判定 |

### C. 与 13:54 那版 Lead 摘要的关系

审计期间该路径已存在一份 123 行的摘要草稿（随后以 `749c12c` 提交）。本文替换为逐条核实版，同时保留它提出但未验证的几条线索，并给出验证结论：

- "target/scriptId 生命周期没有显式失效通知" → **成立**，已并入 §1 修复设计（`targetGeneration`）。
- "压缩后原始工具结果与截图路径丢失" → **部分成立**：摘要模板明确要求保留 `ctx_ref`（`context.mjs:148-153`），但没有 artifact 索引表；已并入 §9 的 BRIEF 设计。
- "切工作区杀任务 / 审批超时 / pending 不恢复" → **成立**，见附录 B。
- "本轮已落地 PR #9" → 对应 `c42f471` / `7ca6bce`；其中 `browser_upload` 未通过真实对象验证（§8.2），不能算完成。
- 该草稿中的行号（如 `workspace.mjs:128/132`）是修复前的，本文统一按 `7ca6bce` 重新核对。

### D. 本文的不确定点（明确标注）

1. 内核工具的实际发行版本由 `src/vendor/core-build` 构建打包，**可能与仓库内 vendored 源码有差异**；§1、§8.1 的结论以日志中的错误文本与 vendored 源码互证，但仍建议在发行组件上复跑一次。
2. `listen EINVAL` 的**触发条件**未在本机复现（只跑了 `--probe`，没跑 `initialize`，避免改变网络状态）。结论"standard 模式真实执行失败"来自日志（A），"原因是 srt initialize/wrap"来自错误前缀（B），"具体是 macOS 绑定/代理问题"是 **D**。
3. PowerShell 相关结论全部是静态代码审查，**没有 Windows 真机**；`Tee-Object` 的 UTF-16 行为依 PS 5.1 文档，未实测。
4. §E2（子代理被父轮次取消）是代码推断（D），样本日志里没有触发实例。
5. 会话日志来自 10-30 的备份构建，其中部分行为（如 `continuation` 的 `source` 字段为空）与当前代码不完全一致；本文只把日志用于"用户真实遇到什么"，不用它推断当前实现细节。
