---
description: "默认开启的产品记忆与角色定义及其管理页。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-memory-bundle

[English](README.md) | 中文

## Summary

DecryptHub 在默认 Web 与 Desktop profile 中随附本组合包，因此产品记忆与角色定义无需另行安装即可使用。它在插件页以官方内置项出现。关闭后会从 profile 中撤下记忆与角色的 Host 行及其管理页。

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

打开 **插件**，在官方列表中找到 **记忆与角色**。Web 与 Desktop profile 默认启用。在侧栏「记忆与角色」页编辑条目与角色文本。仅在需要让这些产品面离开 profile 时关闭本组合包。

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>维护者说明</summary>

[`cordis.patch.yml`](cordis.patch.yml) 插入 `product-memory`、`product-persona` 与 `ui-decrypthub-settings`。本组合包列入 `PROFILE_TEMPLATES.web` 与 `EXTENSION_BUNDLES`，不进入 `OPTIONAL_BUNDLES`。插件页把 `EXTENSION_BUNDLES` 视为官方项，使默认开启的安装组合包保持可见，且不与可选目录重叠。

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

[产品记忆](../../host/product-memory/README.zh.md) · [产品角色](../../host/product-persona/README.zh.md) · [DecryptHub 设置 UI](../../client/ui-decrypthub-settings/README.zh.md)

-----

<a id="model-experience"></a>
## Model Experience

间接经由产品记忆与角色：它们把可编辑设置注入系统提示词，并提供记忆工具。

#### KV Cache effect

本层不直接加入请求内容；挂载的 Host 包负责提示词段落与工具带来的缓存影响。

## Known Limitations and Deferred Work

- 关闭本组合包会同时移除记忆与角色，因为管理页已融合；没有按面拆分的 profile 开关。
