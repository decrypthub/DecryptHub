---
description: "官方组件校验安装与连接管理。"
kind: "package-reference"
---

# @deepseek-ai/dsh-decrypthub-components

[English](README.md) | 中文

## 概述

查看 WDH、ADH、IDH 的实际安装情况，检查官方版本并启用校验后的组件。下载校验 SHA-256 和体积，解压拒绝链接及越界路径。安装失败或取消时保留原活动版本。设备服务地址独立配置。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [Model Experience](#model-experience)
- [已知限制和后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

DecryptHub Web 组合以绝对组件目录挂载此服务，仅 Host 所有者可调用管理接口。bundledWdhEntry 可指向随包 WDH CLI。官方组件页调用状态、确认安装、取消、回滚、浏览器检查及带版本检查的连接配置。只有用户检查更新时才查询版本目录。

<a id="understand-the-implementation"></a>
## 理解实现

连接生命周期由 DSH MCP 客户端管理，配置通过 Settings 服务检查版本。界面仅展示观测到的事实；取消、卸载和重新连接会释放对应订阅或进程。

<a id="model-experience"></a>
## Model Experience

间接影响，通过 MCP 集成提供者选用的已校验组件版本。

#### KV Cache effect

间接影响，重新连接可能改变工具定义。

## 已知限制和后续工作

<a id="known-limitations-and-deferred-work"></a>

- 仅接受代码内指定的 DecryptHub 仓库及提供 SHA-256 的兼容组件包。
- 托管设备组件需要 Python 3.10 或更新版本；设备授权和目标确认不由此服务完成。
- 真实版本下载和设备行为仍需使用实际发布包及支持的设备验证。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护说明</summary>

不在用户正在运行的安装包上覆盖构建；使用隔离数据验收。

</details>
