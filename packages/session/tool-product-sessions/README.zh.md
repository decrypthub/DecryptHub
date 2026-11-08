---
description: "面向模型的会话历史：列出最近会话的标题与时间。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-product-sessions

[English](README.md) | 中文

## 摘要

新增一个只读工具 `session_list`，报告工作区中最近更新的会话及其 id、标题、更新时间。它通过共享的 `ctx.sessionQuery` 服务读取，因此与产品其余部分使用同一份 live-preferred 语料，且不会自己打开会话。

## 目录

- [使用本包](#use-this-package)
- [Model Experience](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>

## 使用本包

在提供 `sessionQuery` 的组合中挂载本插件。`maxSessions` 限定单次调用最多返回多少会话；工具参数 `limit` 可进一步收窄，但不能超过该上限。

<a id="model-experience"></a>

## Model Experience

### session list

#### What the model sees

一个 `session_list` schema，参数为可选的 `limit`；结果为每行 `updatedAt id title`。描述指示模型在用户提到先前工作、但不确定是哪个会话时调用。

#### Token effect

工具本身只占少量固定 schema；每条会话约占一行，因此默认上限是二十而不是全量列出。

#### KV Cache effect

schema 与位置稳定，提示词前缀可持续命中缓存。列会话只追加工具结果历史，不重写已有消息。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

- **不支持内容检索** — 只列会话，不搜索其内容；全文检索需要 SQLite session-query 后端与相应的产品工具。
- **标题尽力而为** — 尚未生成标题的会话返回空字符串，模型需回退到 id。

<a id="dev-note"></a>
### 开发注记

<details>
<summary>维护者工作上下文 — 点击展开</summary>

上游 `dsh-tool-session-query` 已覆盖检索与事件读取，但它位于 `packages/experimental`，而发布 bundle 不允许依赖 experimental 包。本包是可进入默认组合的产品自有子集。

</details>
