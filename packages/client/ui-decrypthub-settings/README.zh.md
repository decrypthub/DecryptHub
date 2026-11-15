---
description: "产品设置分区：记忆目录为主界面，设定角色在同一表面切换到角色编辑并可返回，分别读写各自的设置命名空间。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-decrypthub-settings

[English](README.md) | 中文

## 概述

贡献一个 `settings.section` 入口及对应主面板：默认展示记忆目录，标题旁「设定角色」在同一表面切换到角色编辑（可返回记忆）。记忆目录可列出、搜索、添加、编辑、删除 `product-memory` 条目；角色视图编辑 `product-persona` 文本。两者都通过 `ctx.remote.settings` 读写，因此设置页、设置文档与智能体自己的工具修改的是同一份持久数据，并共用同一套 revision 校验。优先走「让智能体记住 / 设置」，手动编辑作为备选。

## 目录

- [使用本包](#use-this-package)
- [Model Experience](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>

## 使用本包

在同时提供两个命名空间的 profile 中挂载本插件。它不贡献宿主端代码；浏览器半边注册合并分区 `memory-persona`（序号 26）、侧栏入口「记忆与角色」及其词典。用户选择智能体路径时，页面会调用 `uiWorkspace.startSession`。

<a id="model-experience"></a>

## Model Experience

### product settings sections

#### What the model sees

两个分区写的都是模型已经在读的命名空间：这里新增的记忆条目会出现在注入的 `product-memory` 片段中，这里编辑的角色文本会在下一次请求成为 `product-persona` 片段。选择「让智能体记住 / 设置」会打开带本地化草稿提示的会话，模型再通过记忆工具或普通回复完成写入。

#### Token effect

页面本身不增加提示词 token。每条记忆每轮占一行；角色文本每轮按其完整长度计费。

#### KV Cache effect

保存任一页面都会改变注入文本，使改动片段之后的前缀缓存失效。角色文本位于提示词前部，改动它会让整段提示词缓存失效。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

- **角色只有一个全局值** — 角色分区编辑的是部署级定义，不是按会话的 persona。
- **尚无系统记忆查看器** — 只读的产品与插件环境说明仍待独立界面。
- **新建条目只能是跨项目** — 页面没有可绑定的工作区，因此新建时 project 作用域被禁用；工作区记忆由智能体在对话中写入。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

宿主半边必须导出 `apply()`；node 入口什么都不导出的包会被静默移出客户端清单，其设置分区也就不会注册。写入始终携带最近一次 `describe()` 读到的 revision，并在 `settings/document-updated` 时重载两个命名空间，因此其他会话里的智能体写入会同步到已打开的页面，而不是留下过期 revision。目录页视觉对齐自动化任务页：标题操作、作用域筛选、搜索、列表行与详情面板。侧栏与设置共用一个「记忆与角色」入口；角色从记忆标题旁按钮进入同一表面，不再用页内 Tab 或弹层。

</details>
