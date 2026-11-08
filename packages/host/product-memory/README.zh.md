---
description: "注入系统提示词、可由模型维护的分域产品记忆。"
kind: "package-reference"
---

# @deepseek-ai/dsh-product-memory

[English](README.md) | 中文

## 摘要

把持久事实存放在一个 `product_memory` 存储域中，将条目作为单条系统提示词片段注入（受 `maxSectionChars` 限制），并向模型提供 `memory_write`、`memory_list`、`memory_delete`。条目带 `user` 或 `project` 作用域与 ISO-8601 时间戳；持久化由存储域负责，重启后仍在，且不额外写入会话事件。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)

<a id="use-this-package"></a>

## 使用本包

在带存储后端的 profile 组合中挂载本插件。它在首次 apply 时打开 `product_memory`，注册序号 150 的 `product_memory` 片段，并注册三个工具。用 `maxSectionChars` 限定注入长度。

<a id="model-experience"></a>

## 模型体验

模型看到一条注入片段，按 `(scope) text [id]` 逐行列出条目，另加三个工具 schema。片段中带 id，使模型在后续轮次可直接更新或删除某条记忆，无需额外读取。无条目时片段整体为空，不占提示词 token。工具结果各为一行短文本。
