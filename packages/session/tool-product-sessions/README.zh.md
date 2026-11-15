---
description: "面向模型的会话历史：列出最近会话的标题与时间。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-product-sessions

[English](README.md) | 中文

## 概述

新增两个只读工具：`session_list` 报告调用方工作区中最新创建的会话及其 id、标题、创建时间；`session_read` 返回该工作区内某个会话末尾的用户与助手消息。二者都通过共享的 `ctx.sessionQuery` 服务读取，因此与产品其余部分使用同一份 live-preferred 语料，且不会自己打开会话。

## 目录

- [使用本包](#use-this-package)
- [Model Experience](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>

## 使用本包

在提供 `sessionQuery` 的组合中挂载本插件。`maxSessions` 限定单次调用最多返回多少会话；工具参数 `limit` 可进一步收窄，但不能超过该上限。两个工具都按调用智能体的工作区过滤，并拒绝读取另一个工作区下的会话。

<a id="model-experience"></a>

## Model Experience

### session tools

#### What the model sees

两个 schema：`session_list` 带可选 `limit`，`session_read` 带必填 `id` 与可选 `limit`。列表结果为每行 `createdAt id title`；读取结果为每行 `role: text`，取自持久化的 user 与 assistant 事件，工具调用与结果不返回。描述指示模型在用户提到先前工作、但不确定是哪个会话时调用。

#### Token effect

工具本身只占少量固定 schema；每条会话约占一行，因此默认上限是二十而不是全量列出。

#### KV Cache effect

schema 与位置稳定，提示词前缀可持续命中缓存。列会话只追加工具结果历史，不重写已有消息。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

- **不支持内容检索** — 只列会话、读末尾消息，不跨会话搜索；全文检索需要 SQLite session-query 后端与相应的产品工具。
- **标题尽力而为** — 尚未生成标题的会话返回空字符串，模型需回退到 id。
- **只有创建时间** — 存储的 header 只记录创建时间、不记录最后活动时间，因此列表按创建时间倒序，而不是按最近活动倒序。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

上游 `dsh-tool-session-query` 已覆盖检索与事件读取，但它位于 `packages/experimental`，而发布 bundle 不允许依赖 experimental 包。本包是可进入默认组合的产品自有子集。读取器从持久化事件负载（`user/message`、`assistant/message`）重建消息，而不是读合成字段，因此导入的旧格式会话在首次迁移后也能读到内容。

</details>
