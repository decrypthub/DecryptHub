---
description: "产品设置分区：记忆与角色定义，分别读写各自的设置命名空间。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-decrypthub-settings

[English](README.md) | 中文

## 摘要

贡献两个 `settings.section` 入口。记忆分区列出、添加、删除 `product-memory` 条目；角色分区编辑 `product-persona` 文本。两者都通过 `ctx.remote.settings` 读写，因此设置页、设置文档与智能体自己的工具修改的是同一份持久数据，并共用同一套 revision 校验。

## 目录

- [使用本包](#use-this-package)
- [Model Experience](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>

## 使用本包

在同时提供两个命名空间的 profile 中挂载本插件。它不贡献宿主端代码；浏览器半边注册 `memory`（序号 26）与 `persona`（序号 27）两个分区及其词典。

<a id="model-experience"></a>

## Model Experience

### product settings sections

#### What the model sees

两个分区写的都是模型已经在读的命名空间：这里新增的记忆条目会出现在注入的 `product-memory` 片段中，这里编辑的角色文本会在下一次请求成为 `product-persona` 片段。

#### Token effect

页面本身不增加提示词 token。每条记忆每轮占一行；角色文本每轮按其完整长度计费。

#### KV Cache effect

保存任一页面都会改变注入文本，使改动片段之后的前缀缓存失效。角色文本位于提示词前部，改动它会让整段提示词缓存失效。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

- **没有逐条编辑表单** — 记忆只做新增与删除，原地修改复用智能体的 `memory_write` 并传入已有 id。
- **角色只有一个全局值** — 角色分区编辑的是部署级定义，不是按会话的 persona。

<a id="dev-note"></a>
### 开发注记

<details>
<summary>维护者工作上下文 — 点击展开</summary>

宿主半边必须导出 `apply()`；node 入口什么都不导出的包会被静默移出客户端清单，其设置分区也就不会注册。写入始终携带最近一次 `describe()` 读到的 revision，使并发的智能体写入让页面保存失败，而不是静默覆盖。

</details>
