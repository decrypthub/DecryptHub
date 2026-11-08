---
description: "基于 product-memory 命名空间的产品记忆设置分区。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-decrypthub-memory

[English](README.md) | 中文

## 摘要

新增一个 `settings.section` 入口，用于列出、添加和删除产品记忆条目。它通过 `ctx.remote.settings` 读写宿主的 `product-memory` 设置命名空间，因此设置页、设置文档与智能体的记忆工具共用同一个持久来源和同一套 revision 校验。

## 目录

- [使用本包](#use-this-package)
- [Model Experience](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>

## 使用本包

在宿主提供 `product-memory` 命名空间的 profile 中挂载本插件。它不贡献宿主端代码；浏览器半边注册 id 为 `memory`、序号 26 的设置分区，以及 `settings.memory` 词典。

<a id="model-experience"></a>

## Model Experience

### memory section

#### What the model sees

不直接影响模型：本页写入的命名空间与 `memory_*` 工具相同，因此用户的编辑会在下一次请求时作为注入的记忆片段被模型看到。

#### Token effect

页面本身不增加提示词 token。在此添加的条目与模型写入的条目一样，每轮占一行。

#### KV Cache effect

保存编辑会改变注入片段文本，使该片段之后的前缀缓存失效。把多次修改合并为一次保存可减少旧文本的缓存失效。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

- **没有逐条编辑表单** — 页面只做新增与删除，原地修改复用智能体的 `memory_write` 并传入已有 id。
- **没有作用域筛选** — 列表把 `user` 与 `project` 条目混在一起展示。

<a id="dev-note"></a>
### 开发注记

<details>
<summary>维护者工作上下文 — 点击展开</summary>

写入始终携带最近一次 `describe()` 读到的 revision，使并发的智能体写入让页面保存失败，而不是静默覆盖。每次写入成功后重新加载，以保持 revision 最新。

</details>
