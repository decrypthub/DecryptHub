---
description: "用户可编辑的角色定义，作为系统提示词片段注入。"
kind: "package-reference"
---

# @deepseek-ai/dsh-product-persona

[English](README.md) | 中文

## 摘要

把一份角色定义存放在 `product-persona` 设置命名空间中，并以序号 20 注入为系统提示词片段：位于 Harness 身份之后、工作区指引之前。文本为空时不贡献内容；`interpolate: false` 保持原文，因此角色里出现的 `{{变量}}` 不会被改写。该命名空间同时是设置页数据源，用户编辑与部署默认写的是同一字段。

## 目录

- [使用本包](#use-this-package)
- [Model Experience](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>

## 使用本包

在提供设置服务的 profile 中挂载本插件，用 `persona` 配置角色文本。片段会在 `loader/volatile-update` 后重新读取命名空间，因此编辑无需重启即可生效。

<a id="model-experience"></a>

## Model Experience

### role section

#### What the model sees

一条 `product-persona` 片段位于提示词前部，原样携带配置的角色文本，其余片段按各自序号跟随。值为空时该片段整体消失。

#### Token effect

开销就是配置文本本身，且每次请求都计费。因此长角色定义更适合放到 preset 或技能里。

#### KV Cache effect

片段靠近提示词头部，修改它会使整段提示词的缓存失效。应保持编辑克制、频率低。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

- **仅一个全局值** — 该定义对 profile 内所有会话生效；按会话区分的角色仍需在 agent preset 中使用 `dsh-persona`。
- **不做变量插值** — 角色文本按字面处理，不能引用提示词变量。

<a id="dev-note"></a>
### 开发注记

<details>
<summary>维护者工作上下文 — 点击展开</summary>

序号 20 是刻意选择的：Harness 身份保持最前，`dsh-agent-instructions` 的工作区指引仍排在角色之后。全局挂载本行不会与 preset 的 persona 冲突，因为后者按 agent 注册片段。

</details>
