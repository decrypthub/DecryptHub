---
description: "侧栏与会话首屏中的 DecryptHub 品牌。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-brand-decrypthub

[English](README.md) | 中文

## 概述

本产品插件通过侧栏与会话首屏品牌插槽提供 DecryptHub 图形和名称，通过公开主题 API 提供番茄红配色。浅深色中的主控件使用较深红色背景和白色前景。Host 入口不执行操作；客户端注册与主题覆盖随所属插件作用域释放。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

DecryptHub Web bundle 挂载本包，并停用上游官方品牌包。产品名在各界面语言中均为 DecryptHub。本包不请求图片，现有产品图形直接嵌入客户端构建。

<a id="understand-the-implementation"></a>
## 理解实现

客户端在侧栏标志和名称插槽均声明后统一注册这两个填充；会话首屏标志使用独立的声明生命周期。撤销声明或卸载插件时移除相应填充。标志保留界面要求的尺寸与宿主 class。

<a id="model-experience"></a>
## 模型体验

无。本包只提供界面呈现，不注册工具或请求上下文。

#### KV 缓存影响

无。品牌呈现不进入供应商请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 窗口名称、应用图标和构建时浏览器标题由相应应用负责，这些插槽不修改它们。

<a id="dev-note"></a>
### 开发备注

无。
