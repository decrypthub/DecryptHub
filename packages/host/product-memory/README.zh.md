---
description: "注入系统提示词、可由模型维护的分域产品记忆。"
kind: "package-reference"
---

# @deepseek-ai/dsh-product-memory

[English](README.md) | 中文

## 摘要

把持久事实存放在本插件的设置命名空间中，将条目作为单条系统提示词片段注入（受 `maxSectionChars` 限制），并向模型提供 `memory_write`、`memory_list`、`memory_delete`。条目带 `user` 或 `project` 作用域与 ISO-8601 时间戳；持久化由设置命名空间负责，重启后仍在，且不额外写入会话事件。

## 目录

- [使用本包](#use-this-package)
- [Model Experience](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>

## 使用本包

在带设置服务的 profile 组合中挂载本插件。它注册序号 150 的 `product-memory` 片段，并向模型注册三个工具；`maxSectionChars` 限定注入长度。

<a id="model-experience"></a>

## Model Experience

### memory tools

#### What the model sees

注入一条片段，按 `(scope) text [id]` 逐行列出条目（受 `maxSectionChars` 限制），另加 `memory_write`、`memory_list`、`memory_delete` 三个 schema。片段带 id，模型可直接更新或删除某条而无需先读取。

#### Token effect

无记忆时不注入任何内容。有记忆时每条占一行、每轮都计费，因此条目应保持一句话。工具结果各为一行短文本。

#### KV Cache effect

任一记忆变更都会改变片段文本，使该片段之后的前缀缓存失效。保持条目精简、写入不频繁可保留更多缓存。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

- **生成页未验证** — 单测组合中 `settings.describe()` 能带 `autoGenerate: true` 暴露该命名空间，但在打包后的桌面端里渲染尚未端到端验证；手工检查时设置面只显示账号分区。若生成式表单无法表达条目字典，改用产品自有 `ui-decrypthub-settings` 页。

<a id="dev-note"></a>
### 开发注记

<details>
<summary>维护者工作上下文 — 点击展开</summary>

条目以 id 为键存放，单次写入只改一个路径，避免数组下标在增删时错位。模型与设置页共用同一命名空间，因此写入必须走 `ctx.settings.mutate` 以保留 revision 校验。

</details>
