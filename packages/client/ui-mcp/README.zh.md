---
description: "DecryptHub 自定义 MCP 与官方组件管理。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-mcp

[English](README.md) | 中文

## 概述

在设置页管理自定义 MCP，在侧栏管理 DecryptHub 官方组件。导入先预览名称冲突和不支持的连接方式，再保存为停用状态。修改配置检查版本，新环境变量和请求头存入凭据服务。安装、MCP 连接和设备状态分别展示。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [Model Experience](#model-experience)
- [已知限制和后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

DecryptHub Web 组合挂载此插件。在「设置 → 自定义 MCP」中添加本地命令或 Streamable HTTP 服务；也可以导入 mcpServers JSON，先预览冲突再保存。侧栏和设置均提供「官方组件」。启用 ADH / IDH 前填写设备服务地址，下载浏览器内核前确认许可条款。

<a id="understand-the-implementation"></a>
## 理解实现

连接生命周期由 DSH MCP 客户端管理，配置通过 Settings 服务检查版本。界面仅展示观测到的事实；取消、卸载和重新连接会释放对应订阅或进程。

<a id="model-experience"></a>
## Model Experience

间接影响，通过 MCP 配置和官方组件选择改变可连接的工具。

#### KV Cache effect

间接影响，重新连接可能改变工具定义。

## 已知限制和后续工作

<a id="known-limitations-and-deferred-work"></a>

- 导入暂不支持 SSE，冲突名称需要先解决再导入。
- 当前管理 WDH 工具和浏览器文件，内嵌浏览器、抓包和调试工作台尚未迁移。
- MCP 握手成功不代表 Android 或 iOS 设备已连接。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护说明</summary>

不在用户正在运行的安装包上覆盖构建；使用隔离数据验收。

</details>
