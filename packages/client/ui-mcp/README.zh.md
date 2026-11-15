---
description: "DecryptHub 技能与 MCP：标题下 MCP|技能 胶囊 Tab；MCP 页上官方下自定义。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-mcp

[English](README.md) | 中文

设备编辑页提供主动状态检查，分别显示服务在线情况、在线应用列表和检查时间；上次观测不代表持续在线。

## 概述

侧栏与设置提供单一入口「技能与 MCP」：标题下用与记忆页同款的胶囊 Tab 切「MCP / 技能」。MCP 页上方官方组件、下方自定义 MCP；技能页说明目录并由智能体管理。官方组件用横向状态行列出 WDH / ADH / IDH（只显示开关与状态），点开后再安装或连接。导入先预览名称冲突和不支持的连接方式，再保存为停用状态。修改配置检查版本，新环境变量和请求头存入凭据服务。另有「从 DSH 导入」设置分区：先预览再复制官方数据目录里的对话记录，并按原工作区分组；只导入对话记录，因为它是唯一稳定的交换单元。

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
