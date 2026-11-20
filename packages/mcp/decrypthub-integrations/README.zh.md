---
description: "按会话连接 WDH，并管理可选的设备 MCP 服务。"
kind: "package-reference"
---

# @deepseek-ai/dsh-decrypthub-integrations

[English](README.md) | 中文

`decrypthub_status` 供 Agent 在选择目标前读取官方 CLI 的实时状态。组件安装、MCP 连接、服务在线与目标在线分别报告；多个目标匹配时需要用户选择，状态查询不注入也不重启应用。

## 概述

此插件使用共享的 MCP 客户端和管理器。安装 WDH 时会为已打开的聊天准备工具。新开的聊天会在首个模型请求前准备连接。ADH 和 IDH 在配置前保持禁用。

## 目录

- [使用此包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

产品 Web 组合加载此插件。Desktop 安装包提供已安装 WDH 的入口和独立数据目录。独立 Web 部署将 `DSH_WDH_ENTRY` 和 `DSH_WDH_DATA_DIR` 设置为绝对路径。产品组合选择 `wdh.browser: cloak`，使用浏览器前需单独安装内核；供其他组合使用的插件 schema 默认值仍为 `system`。

在 Desktop 对话里，可以让 Agent 根据带安装说明的仓库链接、Streamable HTTP 地址、本地启动命令或 MCP JSON 条目添加服务。确认卡展示待应用的配置。确认后，服务会保存并启用到桌面端配置，并等待正式连接完成工具发现。连接尚未确认时，可以在「技能与 MCP」中查看实际状态。聊天添加不会覆盖已有名称。

插件设置中的 `adh` 和 `idh` 提供 `enabled`、`command` 和 `args` 字段，默认为禁用、可执行文件名 `adh` / `idh` 和参数 `[mcp]`。启用后注册到上游 MCP 管理器，由管理器负责连接状态、重启、工具发现、凭据过滤和进程清理。本包不读取设备凭据，也不自行附加设备。

`startupTimeoutMs`、`closeTimeoutMs` 和 `toolCallTimeoutMs` 默认分别为 10000、5000 和 60000 毫秒。托管安装提供 WDH 入口，部署者也可指定绝对路径 `entry`。WDH 的数据存放在绝对路径 `dataDirectory` 或 `DSH_HOME` 下。插件等安装入口可用后再连接。

<a id="understand-the-implementation"></a>
## 实现说明

每个 Agent 拥有独立的 WDH 客户端，其数据目录由 Agent 身份和工作目录派生。下一步开始前，工作目录变化会先关闭旧客户端，再加载新客户端。最终工具检查还会拒绝当前已准入步骤中发往旧目录的 WDH 工具调用和资源读取。已经发出的调用沿用上游取消行为。无法确认连接关闭时会阻止替换，要求重启应用。

WDH 工具以 `mcp__wdh__*` 出现；启用的设备服务分别使用 `mcp__adh__*` 和 `mcp__idh__*`。调用与结果沿用上游 MCP 对话记录事件。本插件不额外注入模型指令或未记录的上下文。工作目录已过期的调用会失败，并反馈在重连后重试。

Agent 拥有其子 Fiber。销毁 Agent 或本产品插件时会等待客户端清理；卸载产品插件也会撤销设备服务注册。工具名称、结果、重连策略和模型可见的服务说明由共享 MCP 实现负责。

<a id="model-experience"></a>
## 模型体验

### 设备状态与已连接工具

#### 模型看到什么

聊天选定设备和 App 后，`decrypthub_status` 报告所选目标及原进程是否仍有效。重启后和等待重新选择时均保留只读限制。未绑定的聊天返回组件清单和已配置地址。WDH 使用当前 Agent 的浏览器连接。

#### Token 影响

本插件登记 `decrypthub_status`，并在支持配置编辑和用户提问的 Desktop 中登记 `mcp_add`。工具结果经常规流程记入对话。`mcp_add` 返回实际连接发现的工具数量，下一步收到新登记的工具 schema。凭据使用已存储值的引用。共享 MCP 客户端负责登记已连接工具及其说明。WDH 浏览器操作使用 Agent 专属连接。

#### KV Cache 影响

管理工具 schema 保持固定。工具结果向会话追加观测。已连接工具目录与说明随服务贡献变化，遵循上游 MCP 客户端的请求组装方式。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 本包提供 MCP 能力，不在 Desktop 侧栏嵌入 WDH 浏览器画面，不分发浏览器内核，不安装 ADH / IDH，不迁移旧 Harness 凭据，也不更改设备权限。WDH 目录检查不等同于操作系统沙箱。设备工具沿用原有能力和审批策略。

<a id="dev-note"></a>
### 开发备注

测试启动真实 stdio 夹具进程，检查 Agent 目录隔离、立即拒绝旧目录调用、重连和卸载清理，不连接浏览器或设备。
