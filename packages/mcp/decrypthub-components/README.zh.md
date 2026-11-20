---
description: "官方组件校验安装与连接管理。"
kind: "package-reference"
---

# @deepseek-ai/dsh-decrypthub-components

[English](README.md) | 中文

`inspectTargets` 通过已校验的组件 CLI 执行带时限、输出大小限制的 `status --json`。快照保留观测时间，旧 CLI 不支持或查询失败时明确报错；读取设备状态不修改配置、不改变目标进程。

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

抓包面板通过当前聊天持有的 WDH 连接读取数据。列表携带 WDH 进程标识，详情按进程标识和请求 ID 一次返回响应与发起栈。进程更换或记录被移除后，面板提示刷新列表。

`importPreview` 与 `importRun` 只把选中官方 Harness 数据目录里的对话记录复制进本产品目录，不复制其他东西。对话是唯一稳定的交换单元：session JSONL 格式有版本号与明确的迁移契约。会话按 `<projectKey>/<sessionId>` 逐目录复制，只有日志确实存在的归属才会并入，日志物理压缩与目标根不一致的会话会带计数跳过。会为导入的会话复制投影缓存以保留标题；JSON 工作区回退路径通过临时文件原子重写。自动化任务、模型密钥与插件**有意不导入**：它们是内部版本化文件，版本漂移会破坏目标后端；插件需要真正的安装链路而不是文件复制。

<a id="understand-the-implementation"></a>
## 理解实现

连接生命周期由 DSH MCP 客户端管理，配置通过 Settings 服务检查版本。界面仅展示观测到的事实；取消、卸载和重新连接会释放对应订阅或进程。

所有者可以在聊天中从已配置设备选择在线的 Android 或 iOS App。Host 通过已配置的存储域按会话 ID 保存选定地址和原进程身份。保存或清除选择的结果会随重启保留。读取状态时核对原进程。服务不可达时保留未核验的选择，进程变化时需要重新选择。

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
- **Harness 导入只复制对话** — 自动化任务、模型密钥与插件不导入；导入页只暴露「对话记录」一个类别，模型路由、自动化与插件仍在各自页面管理。
- **每个目标根只有一种日志压缩** — 明文与 Zstandard 代际不能共享同一个会话根；导入会跳过不兼容的一侧而不是破坏目标后端，并在结果里报告跳过条数。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护说明</summary>

不在用户正在运行的安装包上覆盖构建；使用隔离数据验收。

</details>
