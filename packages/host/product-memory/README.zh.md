---
description: "注入系统提示词、可由模型维护的分域产品记忆。"
kind: "package-reference"
---

# @deepseek-ai/dsh-product-memory

[English](README.md) | 中文

## 概述

把持久事实存放在本插件的设置命名空间中，作为两条受 `maxSectionChars` 限制的系统提示词片段注入，并向模型提供 `memory_write`、`memory_list`、`memory_delete`。条目带 `user` 或 `project` 作用域与 ISO-8601 时间戳：`user` 条目全局注入，`project` 条目只注入写入它的那个工作区的智能体（条目会记录该工作区）。持久化由设置命名空间负责，重启后仍在，且不额外写入会话事件。

## 目录

- [使用本包](#use-this-package)
- [Model Experience](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>

## 使用本包

在带设置服务的 profile 中挂载本插件。项目记忆按工作区注册表中的会话归属授权。项目条目保存工作区 ID。`maxSectionChars` 分别限定两段系统提示词的长度。

<a id="model-experience"></a>

## Model Experience

### memory tools

#### What the model sees

模型按 `(user) text [id]` 收到全局条目，另有一段列出当前会话所属工作区的条目。`memory_list`、`memory_write` 更新和 `memory_delete` 与提示词组装使用同一套可见性检查。按 ID 更新保留原作用域。

#### Token effect

无记忆时不注入任何内容。有记忆时每条占一行、每轮都计费，因此条目应保持一句话。工具结果各为一行短文本。

#### KV Cache effect

任一记忆变更都会改变片段文本，使该片段之后的前缀缓存失效。保持条目精简、写入不频繁可保留更多缓存。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

- **生成页未验证** — 单测组合中 `settings.describe()` 能带 `autoGenerate: true` 暴露该命名空间，但在打包后的桌面端里渲染尚未端到端验证；手工检查时设置面只显示账号分区。若生成式表单无法表达条目字典，改用产品自有 `ui-decrypthub-settings` 页。
- **旧项目条目。** 只记录目录的条目仍对匹配工作区的成员可见，前提是该工作区在条目创建时已注册。更新时会补记工作区 ID。设置保留归属无法确认的条目。可在设置中核对内容，再从目标工作区的对话保存项目记忆。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

条目以 id 为键存放，单次写入只改一个路径，避免数组下标在增删时错位。模型与设置页共用同一命名空间，因此写入必须走 `ctx.settings.mutate` 以保留 revision 校验。

</details>
