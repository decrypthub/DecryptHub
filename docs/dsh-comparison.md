# DecryptHub 对照 DeepSeek Harness：设计差异清单（第一轮，2026-11-02）

> 本文件是**读代码**的产物，不是读文档。每条都标了 DSH 源码位置。
> 用途：作为改造 DecryptHub 的依据。**不要凭印象改这里的结论，改之前重新读那几行。**

基线：`deepseek-harness` tag `dsh-v0.2.2-alpha.2`（`f3803c9`）
本轮实读文件（共 7 个）：
- `packages/interaction/user-approval/src/index.ts`（307 行，全读）+ `types.ts`
- `packages/plan/plan-mode/src/index.ts`（452 行，全读）
- `packages/goal/goal/src/types.ts`（133 行，全读）
- `packages/subagent/subagent/src/types.ts`（前 120 行）+ `depth.ts`（47 行，全读）
- `packages/terminal/terminal/src/types.ts`（前 102 行）

---

## 一、审批（user-approval）—— 我们错在哪

### DSH 的做法

**闭合四值结果**，`unavailable` 是一等公民：

```ts
const OUTCOMES = ['allowed-once', 'rejected', 'cancelled', 'unavailable'] as const
```

`decide()` 的 waterfall 兜底直接返回 `'unavailable'`：

```ts
this.ctx.waterfall(scopeTarget(...), 'approval/request', req,
  () => Promise.resolve<ApprovalOutcome>('unavailable'),
)
```

**没有应答者 = fail closed = `unavailable`**，不是异常、不是超时、不是挂起。

### 关键设计点（逐条对照）

| # | DSH | DecryptHub 现状 | 差距 |
|---|---|---|---|
| 1 | 四值闭合结果，`unavailable` 明确 | 抛异常 `approval-unavailable`（我刚修的） | 语义上等价，但**没有把「不可用」写进模型可见的状态** |
| 2 | **模型事先知道审批是否可能**：system prompt 注入 `ASK_SENTENCE` / `NEVER_SENTENCE` | 模型不知道，只有撞上了才报错 | 🔴 **模型会白试一次才知道不行** |
| 3 | `policy: 'ask' \| 'never'`，`never` 在服务层**先于任何 listener** 决定，保证确定性拒绝 | 只有 `mode`（read-only/standard/full-access），没有"确定不会批"的显式策略 | 🔴 无法支持无人值守场景 |
| 4 | 审计对 `approval/asked` + `approval/decided` **成对写日志**，且必须在 open turn 内（否则重载时是"崩溃尾巴垃圾"） | 只有 `runs.event()` 的散点记录 | 🔴 崩溃后无法审计"当时到底问了没、结果是什么" |
| 5 | `request()` 在 turn 外调用**直接抛错**，并说明原因 | 无此约束 | 🟡 可能出现孤儿审批 |
| 6 | abort signal 与应答**竞速**：abort 先赢则 `cancelled`，晚到的答案被丢弃 | 有 `signal` 但语义未定义"晚到答案" | 🟡 潜在竞态 |
| 7 | 应答者抛异常 → 吞掉，转 `unavailable`（**不能把调用方的工具调用变成 open**） | 抛异常直接冒泡 | 🔴 应答者 bug 会污染工具调用 |
| 8 | 非词表返回值（rogue）归一为 `unavailable` | 无 | 🟡 |
| 9 | 政策切换通过 `agent.inject()` 通知模型（"用户把审批策略从 X 改成 Y"） | 无 | 🔴 模型不知道策略变了 |

### 结论

我上一轮修的「无监听者立刻抛错」**方向对，但只到 DSH 的第 1 层**。
真正缺的是 **#2 让模型事先知道** 和 **#4 成对审计**。这两个才是消除"一轮一轮踩坑"的关键。

---

## 二、计划模式（plan-mode）—— 我们的完全缺失

### DSH 的做法

计划模式是**每 Agent 的可持久化协作状态**，不是 UI 开关：

- 投影 `plan`（`stateVersion: 4`）折叠 session log，**resume/fork 后状态自动恢复**
- `plan/mode` 事件是 log-only、非 surface、整值替换
- 激活时向 system prompt 注入 `plan:policy` 段
- `exit_plan_mode` 工具**渐进披露**：从第一个 active 的 step 开始准入，之后整个 Session 都保持准入
- 用户选择 → `pendingIntents`（`WeakMap<Session, {active, narrate}>`）→ **只在下一个被接受的 in-turn pre-step 提交**

### 最精妙的三个点

**① 提交时机**（`set()` 的四种返回值）

```ts
set(agent, active): 'committed' | 'queued' | 'cancelled' | 'noop'
```

- 无 open turn → 立即 `committed`
- 有 open turn → `queued`，等下一个 pre-step；**但失败要可重试**

```ts
// Delete only after append succeeds so a failed durable write leaves the selection retryable, not dropped.
session.append('plan/mode', { active })
this.pendingIntents.delete(session)
```

**② 退出计划不走"批准对话框"，走 user-questions**

```ts
intent: { kind: 'plan-review', approve: APPROVE_LABEL, callId: exec.callId }
```

两个选项：`Approve` / `Keep planning`。"继续规划"时反馈**通过 tool result 回到模型**，不是弹个失败。

**③ 用户关掉对话框 ≠ 审批失败**

```ts
if (cause instanceof UserQuestionError && cause.code === 'ASK_CANCELLED') {
  exec.concludeTurn()   // 结束这一轮，不要浪费一次模型请求去干等
  return { approved: false }
}
```

### 结论

DecryptHub **完全没有计划模式**。这是产品级缺口，不是细节。

---

## 三、目标（goal）—— 数据结构上的差距

### DSH 的做法

```ts
export interface GoalRef {
  readonly id: GoalId
  readonly revision: number      // ← 每 durable mutation 递增
}
```

- **CAS（compare-and-set）**：每次修改带 revision，防止并发覆盖
- `GoalPhase = 'active' | 'paused' | 'blocked' | 'complete'`
- `blockedReason: { code, message }` —— **code 供机器路由，message 供人和模型读**
- **`activation` 是进程内的、永不持久化**（`'armed' | 'disarmed'`）
  → 重启后目标还在，但自动续跑需要重新 arm
- 投影 `GoalProjectionState` 含 `seenGoalIds`（拒绝复用 id）和 `failure`（重放失败记录）

### 对照

| DSH | DecryptHub |
|---|---|
| CAS + revision | `goal` 是普通对象，`saveState()` 整包覆盖 |
| `blockedReason.code` + `.message` | 只有 `stopReason: 'model-blocked'` 字符串 |
| `activation` 与耐用状态分离 | 无此分离，重启后行为未定义 |
| 重放失败记录 `failure` | 无 |

### 结论

我们的 goal 是"能跑就行"的水平。DSH 的是**可审计、可恢复、可并发安全**的。

---

## 四、子代理（subagent）—— 最容易踩坑的地方

### DSH 的深度记账（`depth.ts`，47 行，全读）

```ts
export function delegationDepthOf(agent: Agent): number {
  const runtime = agent.options.subagentDepth
  if (runtime !== undefined && (!Number.isSafeInteger(runtime) || runtime < 0 || Object.is(runtime, -0)))
    throw new TypeError('agent subagentDepth must be a non-negative safe integer')
  return Math.max(agent.session.header.delegationDepth ?? 0, runtime ?? 0)
}
```

**核心不变量**：持久化的 session header 是**权威且单调**的。

> runtime `AgentOptions.subagentDepth` may **DEEPEN** the count but can never **LOWER** it —
> a resumed child arrives with fresh options, and counting it from zero would let it
> delegate as if it were top-level.

**这个坑我 100% 不会想到**：子代理会话被恢复时，运行时参数是新的，如果从 0 开始算深度，它会以为自己还是顶级 Agent，于是**无限层级委派**。

### 其他关键设计

- `delivery: 'parent' | 'caller'` —— 结果投递策略（进父会话通知模型 / 只返回给调用方）
- `SubagentInterruptAuthority = {kind:'user', parentSessionId} | {kind:'ancestor', agent}` —— **中断权限要区分"用户直接点"和"祖先代理请求"**
- `subagent/start` + `subagent/end` **成对事件**，`runId` 关联
- `TerminalBackendCleanupError extends AggregateError` —— **启动失败且清理也失败**要同时报两个错，不能只报一个

### 结论

我们 `ResearchAgents` 是简化版。缺：深度单调性、delivery 策略、中断权限区分、成对事件。

---

## 五、终端（terminal）—— 等待语义

### DSH 的做法

```ts
export type TerminalWaitReason = 'stdin_read' | 'inferred_idle' | 'timeout' | 'session_exit'
```

**为什么把控制权还给调用方**有 4 种明确原因：

| 原因 | 含义 |
|---|---|
| `stdin_read` | 程序在读输入（如 `read`、`sudo` 提示）→ **该发东西了** |
| `inferred_idle` | 推断空闲（启发式） |
| `timeout` | 超时 |
| `session_exit` | 顶层进程退出 |

对照我们的 `shellWorkspace`：只有 `exit code` / `timeout` / `cancelled` 三种，**没有"程序在等输入"这个状态**。
所以交互式命令（frida、python REPL、adb shell）只能靠 timeout 硬等——这正是用户抱怨"逆向任务 90% 动作走代码执行"的痛点。

其他：
- `TerminalSendRead.truncated` —— **输出被上限丢弃**要明确标记
- `TerminalSendResult.viewport` —— 返回的是**有界视口**，不是全部输出
- `cancel(): boolean` —— 已结算后返回 false，不假装成功
- 每个 PTY 会话**同时只能有一个活跃的 send operation**

### ✅ 已实现（2026-11-02）

新增 `sidecar/agent-terminal.mjs` + 四个工具（`terminal_open` / `terminal_send` / `terminal_read` / `terminal_close`），
复用会话已有的 node-pty（`SessionTerminals`，UI 用的同一套）。四值 `waitReason` 全部落地。

**真实链路验收暴露的两个坑（单测过不了、只有真机才现形）：**

1. **ANSI 控制序列**：真实 PowerShell 提示符是
   `\x1b[0m\x1b[0KPS C:\path>\x1b[0K\x1b[54G`，
   提示符后面紧跟光标控制序列。不先 `stripAnsi()` 就永远匹配不到"提示符在行尾"，
   `stdin_read` 永远不会触发。**单测用干净字符串能过，真实环境必败。**
2. **判断顺序**：必须先**等输出安静 ≥ idleMs** 再判断。
   - 不能一看到提示符就返回 → 命令正文还没到就误报 `stdin_read`
   - 不能只看"有提示符"不看进程状态 → 程序退出后 shell 又印新提示符，会被误报成在等输入
   正确的实现：循环里**退出优先**，其余情况**安静后才分类**。

验收脚本：`scripts/verify-terminal-live.mjs`（起真实 SessionManager + 真实 PTY，
实测「发命令→看到输出→发输入→拿到响应→exit→session_exit」全链路）。

**结论**：交互式终端从「不可用」变为「可用」，且四值语义与 DSH 一致。

---

## 六、改造优先级（建议）

| 优先级 | 项 | 理由 |
|---|---|---|
| P0 | 审批：模型事先知道策略（`ASK`/`NEVER` 进 system prompt） | 直接消除"白试一次才知道不行" |
| P0 | 终端：`TerminalWaitReason` 四种原因，特别是 `stdin_read` | 交互式命令当前不可用 |
| P0 | 子代理：深度单调性（header 权威） | 恢复后层级失控是隐蔽灾难 |
| P1 | 计划模式（整个模块） | 产品级缺口 |
| P1 | goal 的 CAS + revision + `blockedReason.code` | 并发安全与可审计 |
| P1 | 审批：`approval/asked` + `approval/decided` 成对审计 | 崩溃后能复盘 |
| P2 | `delivery` 策略、中断权限区分、成对 `subagent/start|end` | 精细化 |
| P2 | 输出截断的双向明确标记（`truncated`） | 已做了一部分 |

**浏览器不参考**：DSH 的 browser-use/computer-use 不如自研 WDH 贴业务。

---

## 七、我们缺什么（代码级实测，2026-11-02）

用 `grep` 在本仓 `sidecar/*.mjs`、`ui/src/*` 实测：

| 能力 | DSH 有 | DecryptHub | 影响 |
|---|---|---|---|
| plan mode | `plan-mode` 全模块 | ❌ **零** | 无法先规划后执行 |
| 终端等待语义 | `stdin_read`/`inferred_idle`/`timeout`/`session_exit` | ❌ 只有 exit/timeout | **交互式命令不可用**（frida/adb/python REPL） |
| 事件版本门 | 未知类型必须 `ignorable:true` 才跳过，否则拒绝加载 | ❌ 静默忽略 | 静默重建出错误会话 |
| 子代理深度单调 | `max(header.delegationDepth, runtime)` | ❌ 无 | 恢复后层级失控 |
| 输出 spill（首尾保留） | `retainContent(maxTokens - reserved)` | ❌ 裸截断 | 长输出丢失中段且不可取回 |
| 粘贴撤销边界 | `PASTE_TAG` 独立 history boundary | ❌ 无 | Ctrl+Z 会连带吃掉粘贴内容 |
| 审批策略进 prompt | `ASK_SENTENCE`/`NEVER_SENTENCE` | ❌ 无 | 模型白试一次才知道不行 |
| 审批成对审计 | `approval/asked` + `approval/decided` | ❌ 散点日志 | 崩溃后无法复盘 |
| 标题来源可追溯 | `SessionTitleSource` + `messageSeqs` | ⚠️ 有 `titleSource` 但无 `messageSeqs` | 无法知道标题据何而来 |
| 忙时 Enter 语义 | `queue` / `steer` 可配 | ❌ 无 | AI 忙时用户体验差 |

---

## 八、第二轮实读（本次新增，共 12 个文件）

### spill-policy（`packages/spill/spill-policy/src/index.ts`，152 行全读）

**这是"输出膨胀"的正确解法**，比我们的裸截断高一个维度：

1. **首尾各留 + 中间打洞**，不是砍尾巴：
   ```ts
   const result = retained.head.length + retained.tail.length === 0
     ? [footer]
     : [...retained.head, GAP, ...retained.tail, ...]
   ```
2. **完整内容落盘**成 `SpillRef`，模型能按路径取回
3. **图片按真实 token 价格计价**（`calculator.priceImages(images)`），不是按字节估
4. **估算失败就保留原内容**并 `logger.warn`——**绝不因为压缩失败丢掉成功结果**
5. **通知本身超预算直接抛错**，不允许"压缩了还是超"
6. `reserved = price(GAP) + price(worstNotice)` —— **先给空洞和通知留够预算**再算能留多少
7. 相邻 text block **合并**（`Adjacent text has one framing cost on the wire`）

### 会话持久化（`packages/session/session-persistence/src/storage-contract.ts`）

**版本门的设计原则**：

```ts
if (!KNOWN_SESSION_EVENT_TYPES.has(event.type) && event.ignorable !== true) {
  throw unsupported(`... unknown to this harness and not marked ignorable; refusing to interpret the log ...`)
}
```

> 静默跳过未知的必要事件 **可能重建出错误的会话**。

三个契约函数：`assertStoredId`（id 不符拒绝）、`assertVersion`（版本不符拒绝 + 报原始路径）、`validateStoredEvents`（逐条 adopt + freeze）。

### 会话标题（`packages/session/session-title/src/types.ts`）

- `SessionTitleSource` 三态：`fallback` / `provider`(+model) / `user`(**pins the title, 自动生成停止调度**)
- `messageSeqs` —— 记录标题由哪些 `user/message` 推导，**可追溯**
- `TitleInputState { first, count, ... }` —— 只保留**最旧**一条 + 计数，不无限累积

### 输入提交策略（`ui-conversation/src/client/input/submission-policy.ts`）

AI 忙时按 Enter 的行为**可配**：

```ts
if (!running || !steeringAvailable) return 'queue'
if (gesture === 'enter') return preferred          // 用户设定的偏好
return preferred === 'queue' ? 'steer' : 'queue'   // 加速键取反
```

- `Send` 按钮与 Enter **共用同一 gesture**，保证"按钮发的东西和 Enter 一样"
- `steer` 是 best-effort：窗口关了会变成下一个 Queue 项

### 粘贴（`ui-conversation/src/client/input/editor/runtime.ts`）

```ts
/**
 * PASTE_TAG makes the paste its own history boundary, so one undo never
 * removes both the paste and typing inside the merge window.
 */
```

**粘贴必须成为独立撤销边界**——否则 Ctrl+Z 会连带吃掉粘贴后的输入。

---

## 九、权限预设（第三轮实读，已落地）

### DSH 读了哪些文件

- `packages/interaction/permission-presets/src/index.ts`（482 行，全读）
- `packages/interaction/permission-presets/src/types.ts`（全读）
- `packages/interaction/permission-presets/README.zh.md`
- `packages/client/ui-permission-presets/src/client/PermissionSelect.tsx`（全读）
- `packages/client/ui-permission-presets/src/client/PermissionRow.tsx`（全读）
- `packages/client/ui-permission-presets/src/client/presentation.ts`、`catalog.ts`、`locales.ts`
- `packages/client/ui-primitives/src/PermissionIcon.tsx`、`RiskConfirmation.tsx`、`RiskConfirmation.module.css`、`Menu.tsx`
- `packages/bundle/base/cordis.patch.yml`（`permission` 与 `approval` 两段配置）
- `packages/sandbox/sandbox-policy/src/session-mode.ts`、`packages/sandbox/sandbox/src/index.ts`
- `apps/web/tests/access-confirmation.e2e.ts`（真实期望快照）

### 核心数据结构

```ts
interface PresetSpec {
  sandbox: 'read-only' | 'workspace-write' | 'danger-full-access'   // 文件效果沙箱
  approval: 'ask' | 'never'                                          // 审批策略
  name?: string; description?: string                                // 客户端呈现
}
export const CUSTOM_PRESET = 'custom'   // 只能推导，永远不是可选行
export const AUTO_PRESET = 'auto'       // 固定实验身份：danger-full-access + ask
```

一个预设就是**两个机制旋钮的捆绑**。服务只负责「记录选了哪个 + 把变动写进各自的权威 setter」，
执行侧仍然各读各的旋钮。这条分层是全部设计的地基。

### 我原以为不重要、但它处理了的边界（至少 5 条）

1. **`custom` 只能被推导，不能成为切换目标**：`optionOf('custom')` 只喂给「当前值」显示，
   `catalog().options` 里永远不含它；`set()` 对 unknown name 直接抛错。否则用户能把一个
   「当前不匹配任何预设」的状态固化成一份新预设。
2. **共享捆绑时靠 `permission/preset` 事件保住用户意图**：`danger-full-access+never` 与
   auto 的审批策略相同，纯靠旋钮推导会分不清用户选的哪个，所以要多一条 log-only 事件。
   反过来说：**旋钮组合与预设一一对应时，这条事件就是多余的**——DecryptHub 正是这种情况。
3. **净变化为零时不写任何事件**：`if (current !== name) session.append(...)`，然后只写
   「实际值真的变了」的旋钮。避免一次无意义的点击在会话日志里留痕。
4. **`derive()` 的解析顺序**：最近一次选择（仍然匹配）→ 配置表第一个匹配项 → `custom`。
   `auto` 在 `approval: 'never'` 下也匹配（委派子会话会 pin 成 never）。
5. **恢复时 auto 身份必须有 live integration**：`pinInitialPermission()` 在没有 Auto 注册时
   **抛错拒绝创建**，而不是静默降级成 full-access。「既不改写它，也不静默推导」。
6. **目录失效即撤销显示**：`invalidations` 与 `store` 是两个 observable —— 前者每次失效打点
   （持有已展示选项的消费者据此关闭弹层），后者只在读取成功时发布。混用一个会让「重新读取
   成功」被误当成「刚刚失效」。
7. **风险确认是勾选门禁，不是普通确认框**：`RiskConfirmation` 的主按钮在勾选前 `disabled`；
   且**带参的 `/permission <preset>` 不弹框**——显式键入本身就是明确同意。

### 我们落地了什么

| 项 | 实现 | 与 DSH 的差异及理由 |
|---|---|---|
| 三档预设表 | `sidecar/permission-presets.mjs` `PERMISSION_PRESETS` | 无差异（顺序与文案一致） |
| `custom` 推导 | `currentPreset(mode, review)` | 我们的 `custom` 只有一种来源：`review=auto`（规则自动批准） |
| `permission/preset` 事件 | **不加** | 我们 `(mode, review)` 与预设一一对应，`presetKnobs` 写回必推导回自身（有测试锁）；多一条事件就是第二处真相 |
| 勾选式风险确认 | `kit.jsx` `askRiskConfirm` | 同款门禁；文案保留本项目两条真实语义（运行中立即生效并放行待批、随会话保存） |
| `/permission` | `ui/src/commands.js` + `bus.jsx` | 裸调用报告当前预设；带参直接切换；对外名用 DSH 的 machine value，同时接受历史内部名 |
| 预设随会话持久化 | `sessions.mjs` 去掉 `full-access → standard` 的落盘降级 | **与旧行为相反**（原为「仅本次运行有效」），2026-11-02 用户决定对齐 DSH |
| 规则自动批准（`review=auto`） | 菜单里**不可选**，仅作当前值显示 | DSH 没有这个旋钮；按用户选择照搬 `custom` 的处理方式，不发明 EXP 项 |
| 模型可见的权限名 | `agent.mjs` 注入预设名而非 `standard` | DSH 走 `systemPrompt.context()` 注入 `ASK_SENTENCE`/`NEVER_SENTENCE`；我们用同一条思路，只是文案层 |

### 门禁

- `sidecar/test/permission-presets.test.mjs` 7 项：档位数与顺序、`custom` 不可选、
  `presetKnobs` 写回必推导回自身、命令行别名、提示行不暴露内部值、**零顶层 import**
  （Vite 会把 `node:*` 打进浏览器产物，见 `BASELINE.md` 坑 0）
- 真实链路截图验证：菜单只有三项、勾选前「启用完全权限」按钮 `disabled=true`、
  切换后 trigger 变成 `访问模式，当前：完全权限` 且变红
- `node --test --test-concurrency=2 sidecar/test/*.test.mjs` → **483 / 483**
- `npm run build:ui` ✅ / `node scripts/audit-ui.mjs` ✅ / `node --test "ui/test/*.test.mjs"` → **59 / 59**

---

## 十、文件管理（`ui-sidebar-files`）—— 本轮已对齐（2026-11-02）

本轮实读（`packages/client/ui-sidebar-files/`）：`store.ts`（全读，376 行）、`FileTree.tsx`（全读，288 行）、
`face.ts`（全读，770 行）、`directory-node.ts`（153 行）、`FileNavigator.tsx`（206 行）、`FilesBody.tsx`、`FilesTitle.tsx`、
`NavigatorToggle.tsx`、`workspace-tree.ts`、`navigator-layout.ts`、`FileTree.module.css`、`locales.ts`、`index.ts`、`definition.tsx`；
外加 API 侧 `packages/api/workspace-files/src/types.ts` 与 `index.ts`（`WorkspaceDirectoryEntry` / `RemoteErrorDetailsMap`）。

### 它的真正精髓（不在文档里，在代码的边界处理里）

1. **`refreshing` 是独立状态**：`ready` 层重新列举时**保留旧条目**（`store.ts:276-284`）。
   直接清空整棵树重拉，用户每按一次刷新就会看到一次闪空。
2. **失败不清条目**：`ready` 层失败只是挂 `failure`（`store.ts:310-316`），
   同时把它下面所有层的 `refreshing` 清掉——父目录都没读成，子层不可能有新的。
3. **重列后剪子目录**：某目录重列后不再出现的子目录，其自身与**全部后代**从 `expanded`/`levels` 里删（`store.ts:288-303`）。
   不剪就会永远试图展开一个已不存在的目录。注意剪枝必须按「路径 + `/`」比较，否则 `src/a` 会误剪 `src/ab`。
4. **排序是调用方的事，但规则固定**：目录优先 + `Intl.Collator(undefined,{numeric,sensitivity:'base'})`（`FileTree.tsx:129,176-186`）。
   用 `localeCompare` 会让 `file10` 排到 `file2` 前面。
5. **`locateFile` 的 `pending`**：路上有层在读、或缺名字但那层正在重列时**不下结论**（`store.ts:160-178`）。
   过早判定「文件不在」会让已打开文件的当前行标记闪烁。
6. **失败按错误码分文案**，未知码保留传输层消息（`workspace-tree.ts:24-33`）。
7. **监听先就绪再列举**：`watch()` 产生 `ready`/`change` 两个帧，`ready` 才触发首次列举（`face.ts:44-70`、`directory-node.ts:119-133`）——
   先监听再读，避免「列举完成」与「开始监听」之间漏掉变化。
8. **DSH 没有任何自定义键盘导航**：树行是纯 `<button>`，靠 Tab 顺序（`FileTree.tsx:200-231`）。
   它也因此不存在「ARIA tree 语义与 button 冲突」的问题。
9. **导航栏**：260px 默认 / 最小 180 / 560 与 400 两档切 `push|overlay|fill`（`store.ts:11-58`、`FileNavigator.tsx`）。
   宽度是**每个分栏**的记忆，不是全局。

### 已落地到 DecryptHub

| DSH 语义 | 落点 | 验收 |
|---|---|---|
| 逐层状态机 + `refreshing` + 剪枝 + 失败保条目 | `ui/src/file-tree-model.js` | `node --test "ui/test/*.test.mjs"` 含 21 条状态机断言 |
| 契约 `{name,type,size?}` + 错误码 + `truncated` | `sidecar/file-view.mjs` | `node scripts/verify-files-live.mjs` |
| 逐目录监听 + 变化回推 | `file-view.mjs DirectoryWatches` + `workspace-watch` RPC | 同上 ③④⑤ 段 |
| 按错误码分文案 | `ui/src/files.jsx failureText` | 同上 ② 段 |
| 当前文件 `aria-current` + 滚进视野 | `files.jsx` `currentPath`/`currentRef` | 截图实测标记 1 个 |
| 宽度可调（拖 + 键盘 + 持久化）、Escape 收起 | `files.jsx` | 截图 + 收起态 |

真实链路验收 `node scripts/verify-files-live.mjs`：**22 / 22**（契约 7 + 错误码 4 + 监听 5 + 开关 3 + 释放 3）。

### 与 DSH 的有意差异（都是正当理由，不是遗漏）

| 差异 | 理由 |
|---|---|
| 保留方向键 / Home / End 树内导航 | DSH 没有；本仓既有且更好用，用户明确要求保留。ARIA 从 `role=tree`+`treeitem`（挂在 button 上不合法）改为 `role=group` + `aria-expanded`/`aria-current` |
| 符号链接报 `other` 而非目标类型 | DSH 的 `type` 只是「列目录事实」、`read` 仍拒链接；我们干脆不承诺可读性，避免界面把它显示成可展开的目录 |
| 不补出路径里缺失的父目录 | DSH 的树从扁平 `entries` 反推层级；我们每层单独列举，补一个没有列举结果的目录只会画出点不开的空壳 |
| 保留「Git 改动」与多根目录切换 | 本仓业务能力，DSH 无对应概念 |
| 监听由界面整份上报展开集 | DSH 是每层一个 `DirectoryNode` 持自己的流；RPC 粒度下差集开关往返更少，收起/换会话的释放是天然的 |

### 仍未覆盖

- `ui-sidebar-documentpreview`（预览与导航栏的行宽协商 `PUSH_FROM`/`FILL_BELOW`/全屏三档）。
  我们右栏是「一棵树 + 可调高度」，没有「预览与树共享一行」的结构，这套几何没搬。
- `ui-file-actions` / `ui-open-in-app` 的右键菜单体系。
- `fs-observation-policy`（观察策略：哪些路径该 watch、节流参数）。

---

## 十一、下一轮要读的（仍未覆盖）

- 工具设计：`packages/tool-*` 系列的具体 schema 与错误约定（**用户点名的第 1 项，优先**）
- 会话持久化主体：`session-persistence-jsonl/src/index.ts`（1740 行）、`generation.ts`（994 行）、`lease.ts`（127 行，多进程租约）
- 会话标题主体：`session-title/src/index.ts`（796 行）
- 对话显示：`ui-chat`、`ui-conversation`、`ui-tool`（工具卡片渲染）、`ui-trajectory`、`client-ui-cot-translation`（思维链翻译）
- 长文本/附件：`attachment-local`、`spill/spill`、`spill/spill-local`、`client/file-upload`
- 文件管理：**已覆盖**（见第十节）；仍余 `fs-observation-policy`（观察策略）
- 项目管理：`workspace-controller`、`workspace-changes`、`worktree`
- 终端主体：`terminal-bash/src/session.ts`（729 行，**交互式核心**）、`sanitize.ts`（175 行）
- 上下文压缩：`compaction*`、`token-meter`、`spill-policy`（已读）
- 工具执行器：`tool-executor-*`、`executor`（审批与执行的边界）
