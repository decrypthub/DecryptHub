# Agent 运行时：四个接缝

1.3.1 之前，agent 的三件事混在一起：循环、上下文改写、provider 差异。这份文档记录把它们
切开之后的边界，以及每个接缝「想解决什么」，方便后续替换实现而不是继续往里加 if。

历史调研见 [context-design.md](./context-design.md)（压缩策略对标 Pi / Codex / opencode /
Gemini CLI / Claude Code）。本文只讲**结构**。

## 当前产品注册表

`catalog.mjs` 是运行时和设置页共用的注册表，默认只有工作区、计划、提问/压缩与通用浏览器工具。`browser_open` 无需先手动启动浏览器；其他网页操作按需暴露。旧逆向注册表只用于兼容，不进入产品清单。工作目录、运行状态和执行器见 [executor.md](./executor.md)。

## 数据流

```
send()                        ── 编排：压缩决策 → 调模型 → 跑工具 → 收尾
 ├─ maybeAutoCompress()       ── 触发线 / 每轮上限 / 冷却
 ├─ askModel()                ── provider.complete() + 网络抖动退避
 ├─ runToolBatch()            ── 逐个校验执行 + 追加 tool 事件 + 中断补齐
 └─ History                  ── 只追加的事件日志
      ├─ append()             ── user / assistant / tool 事件
      ├─ commitSummary()      ── 检查点事件（覆盖它之前的所有事件）
      └─ view()               ── 派生 wire messages：拼检查点、裁剪旧工具结果
```

五个文件：

| 文件 | 职责 | 不该做的事 |
|---|---|---|
| `contract.mjs` | 工具 schema 与入参校验 | 不碰业务流程 |
| `agenttools.mjs` | 交给模型自己决定的两件事：`ask_user` / `compact_context` | 不代替模型做判断 |
| `providers/*` | 一个 `complete()` 接口 + OpenAI / Anthropic 适配 | 不做重试策略以外的决策 |
| `history.mjs` | 事件日志与派生视图 | 不改写已有事件 |
| `agent.mjs` | 循环编排 | 不直接依赖 `localtools`（注册表由调用方注入） |
| `policy.mjs` | 风险分类与批准（只读/标准/宿主机权限） | 不看模型自填的 `confirm` |

## 接缝一：工具契约（`contract.mjs`）
一份声明同时产出两样东西：喂给模型的 JSON Schema，和宿主边界的运行时校验。

```js
import { object, str, num } from './contract.mjs';
{ name: 'probe', description: '…', schema: object({ path: str('路径'), depth: num({ min: 0 }) }, ['path']), run }
```

- `Agent.runTool()` 在调用 `run()` 前统一 `validateArgs()`；类型不符会先做安全强转
  （`"5"` → `5`、`"true"` → `true`），强转不了就以 `isError` 回喂模型让它自己改。
- 未声明的字段默认原样放行（不改变旧工具的宽松语义）；工具可以设 `strict: true` 只保留声明字段。
- 含 `oneOf` / `anyOf` / `$ref` 的 schema 直接放行——那是 MCP 内核工具的写法，不该被本地规则误杀。
- `registryIssues()` 做启动期体检：重名、缺 `run`、schema 不是 object。`index.mjs` 记进日志，
  `test/contract.test.mjs` 断言为 0。

刻意没有引入 zod：校验只依赖 JSON Schema 子集，注释里写的约束能让模型和你自己都读到同一份。

## 接缝二：Provider 适配器（`providers/`）

```js
const p = resolveProvider(settings);            // { id, cfg, complete }
const r = await p.complete(messages, tools, { onDelta, onReasoning, signal });
// → { content, reasoning, toolCalls, usage, finishReason }
```

- 两个适配器返回**同一个形状**，`usage` 统一成 OpenAI 字段（`prompt_tokens` /
  `completion_tokens` / `prompt_tokens_details.cached_tokens`）。Anthropic 的
  `input_tokens`、`cache_read_input_tokens`、`stop_reason` 都在 `providers/anthropic.mjs` 里换算。
- 在此之前 Anthropic 分支不返回 usage：走 Claude 的用户，上下文仪表永远按模型名推断、用量显示 0。
- 重试分成两层：适配器负责「本步还没产出任何输出」的抖动重试（最多 2 次），循环负责整步退避重做（最多 3 次）。
- `retryBaseMs` 可注入，测试里设 5ms 而不是真的等 2 秒。

`llm.mjs` 仍是薄门面，`import { chat } from './llm.mjs'` 的老调用方式不变。

## 接缝三：事件化历史（`history.mjs`）

事件只有四种：

| 事件 | 说明 |
|---|---|
| `user` | 用户消息；`att` 记附件 token |
| `assistant` | 正文 + `reasoning` + `calls`（工具调用） |
| `tool` | 工具结果；`id` 对应 `calls[].id` |
| `summary` | 检查点。**它覆盖自己之前的所有事件** |

视图规则：取最后一个 `summary` 之后的事件，前面拼一条摘要消息（必要时补一条
「已了解之前的上下文」保持 user/assistant 交替）。

因此：

- **压缩不再改写历史**，只是追加一条 `summary`。旧事件仍在 `.agent-history.json` 里，
  `/rewind` 和 fork 以后可以直接建立在它上面。
- **裁剪旧工具结果发生在视图阶段**（`view({ prune })`），返回的 wire messages 里是
  `ctx_ref` 引用，事件本身不动。落盘按内容去重，同一段输出只存一份。
- `persist()` 不再把工具结果截到 4000 字符——存的和内存里的是同一份。
- 落到 `.agent-history.json` 的是 `{ v: 2, events: [...] }`；读到旧格式（消息数组）会自动
  迁移：`_summary` 消息变成 `summary` 事件，`_ack` 丢弃后由视图重新生成。

唯一需要当心的不变式：**视图里不能出现孤儿 tool 结果**（没有前置 `tool_calls` 的
`role: 'tool'`），否则两个 provider 都会 400。`plan()` 的切点只会落在 user/assistant 上，
`view()` 还会额外丢掉开头的孤儿 tool 事件。

## 接缝四：可测的循环（`agent.mjs` + `test/loop.test.mjs`）

- `chat` 由构造参数注入（`chatFn`），`tools` 也由调用方注入——`agent.mjs` 不再反向
  import `localtools`，所以不装浏览器依赖也能 import 整个循环。
- `maybeAutoCompress()` / `askModel()` / `runToolBatch()` 各自只有一个理由变化，
  `send()` 只剩编排。
- 用假 provider 就能覆盖那些以前只能靠真机复现的行为：工具批处理顺序、参数校验回喂、
  步数上限收尾、中断补齐、自动压缩触发、落盘恢复、兜底裁剪。见 `test/loop.test.mjs`。

## 测试一览

```bash
cd sidecar
node test/contract.test.mjs      # 工具契约与注册表体检
node test/providers.test.mjs     # 两个适配器（本地假 SSE 服务端）
node test/history.test.mjs       # 事件日志、视图、裁剪、迁移
node test/loop.test.mjs          # 整循环（假 provider，无网络无浏览器）
node test/context.test.mjs       # 压缩切分与摘要模板
node test/browser-close.test.mjs
node test/proctree.test.mjs
node test/embed.test.mjs
node test/workspace-agent.test.mjs
```

CI 里仍是 `node --test test/`（跑全部文件）。本地若没装 `sidecar/node_modules`，
`contract.test.mjs` 的「真实注册表」用例会自动 skip；`workspace-agent.test.mjs` 里依赖
`workspace_shell` 的两个用例需要能 spawn 子进程，受限环境会失败，属环境问题。
