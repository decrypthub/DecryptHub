---
description: "默认开启的技能管理与 MCP 配置及其管理页。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-mcp-bundle

[English](README.md) | 中文

## 概述

DecryptHub 在默认 Web 与 Desktop profile 中随附本组合包，因此技能管理与 MCP 配置无需另行安装即可使用。它在插件页以官方内置项出现。关闭后会从 profile 中撤下技能工具与「技能与 MCP」管理页。

## 目录

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

打开 **插件**，在官方列表中找到 **技能与 MCP**。Web 与 Desktop profile 默认启用。在侧栏「技能与 MCP」页管理自定义服务器、官方组件与技能清单。仅在需要让这些产品面离开 profile 时关闭本组合包。

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>维护者说明</summary>

[`cordis.patch.yml`](cordis.patch.yml) 插入 `tool-skill-manage` 与 `ui-mcp`。共享的 MCP 管理器仍留在 `@deepseek-ai/dsh-web-app`。本组合包列入 `PROFILE_TEMPLATES.web` 与 `EXTENSION_BUNDLES`，不进入 `OPTIONAL_BUNDLES`。

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

[技能管理工具](../../skill/tool-skill-manage/README.zh.md) · [MCP UI](../../client/ui-mcp/README.zh.md)

-----

<a id="model-experience"></a>
## Model Experience

间接经由技能管理工具：模型可在配置的技能根下创建、列出与删除技能。

#### KV Cache effect

本层不直接加入请求内容；挂载的技能工具负责工具目录与结果带来的缓存影响。

## Known Limitations and Deferred Work

- 关闭本组合包会同时移除技能工具与 MCP 管理页；web 组合层中的共享 MCP 管理器仍然保留。

<a id="dev-note"></a>
### 开发备注

无。
