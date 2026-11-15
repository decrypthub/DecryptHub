---
description: "DecryptHub 技能与 MCP：标题下 MCP|技能 胶囊 Tab；MCP 页上官方下自定义。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-mcp

[English](README.md) | 中文

设备编辑页提供主动状态检查，分别显示服务在线情况、在线应用列表和检查时间；上次观测不代表持续在线。

## 概述

侧栏和设置中的「技能与 MCP」入口统一管理官方组件与自定义 MCP，并提供独立技能页签。组件卡片显示已观测状态，并打开配置对话框。导入会在保存前报告冲突和不支持的传输；连接编辑使用修订检查与凭据引用。「从 DSH 导入」把 Harness 数据目录中的对话复制到本应用，并按原工作区分组；仅导入对话。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [Model Experience](#model-experience)
- [已知限制和后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

DecryptHub Web 组合挂载此插件。打开「技能与 MCP」，默认在 MCP Tab：上方官方组件横向状态行（点开后安装、选内核或连接设备），下方自定义 MCP。切到技能 Tab 管理技能目录。下载浏览器内核前确认许可条款。

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
- Harness 导入只复制对话记录：自动化任务、模型密钥与插件有意不导入；技能目录按最新对话解析，没有对话时显示说明性空状态。
- 当前管理 WDH 工具和浏览器文件，内嵌浏览器、抓包和调试工作台尚未迁移。
- MCP 握手成功不代表 Android 或 iOS 设备已连接。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护说明</summary>

不在用户正在运行的安装包上覆盖构建；使用隔离数据验收。

</details>
