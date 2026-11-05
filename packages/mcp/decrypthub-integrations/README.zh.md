---
description: "按会话连接 WDH，并管理可选的设备 MCP 服务。"
kind: "package-reference"
---

# @deepseek-ai/dsh-decrypthub-integrations

[English](README.md) | 中文

## 概述

此 DecryptHub 产品插件组合上游 MCP 客户端和管理器，不重写对话、输入框、自动化或工具卡片界面。WDH 在 Agent 第一步开始时启动；ADH 和 IDH 在配置前保持禁用。

## 目录

- [使用此包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

产品 Web 组合加载此插件。Desktop 安装包提供已安装 WDH 的入口和独立数据目录。独立 Web 部署将 `DSH_WDH_ENTRY` 和 `DSH_WDH_DATA_DIR` 设置为绝对路径。产品组合选择 `wdh.browser: cloak`，使用浏览器前需单独安装内核；供其他组合使用的插件 schema 默认值仍为 `system`。

插件设置中的 `adh` 和 `idh` 提供 `enabled`、`command` 和 `args` 字段，默认为禁用、可执行文件名 `adh` / `idh` 和参数 `[mcp]`。启用后注册到上游 MCP 管理器，由管理器负责连接状态、重启、工具发现、凭据过滤和进程清理。本包不读取设备凭据，也不自行附加设备。

`startupTimeoutMs`、`closeTimeoutMs` 和 `toolCallTimeoutMs` 默认分别为 10000、5000 和 60000 毫秒。启用 WDH 时，`entry` 和 `dataDirectory` 必须是绝对路径；不合法的路径会使插件激活失败。可执行文件缺失和服务不可用沿用上游 MCP 的失败报告。

<a id="understand-the-implementation"></a>
## 实现说明

每个 Agent 拥有独立的 WDH 客户端，其数据目录由 Agent 身份和工作目录派生。下一步开始前，工作目录变化会先关闭旧客户端，再加载新客户端。最终工具检查还会拒绝当前已准入步骤中发往旧目录的 WDH 工具调用和资源读取。已经发出的调用沿用上游取消行为。无法确认连接关闭时会阻止替换，要求重启应用。

WDH 工具以 `mcp__wdh__*` 出现；启用的设备服务分别使用 `mcp__adh__*` 和 `mcp__idh__*`。调用与结果沿用上游 MCP 对话记录事件。本插件不额外注入模型指令或未记录的上下文。工作目录已过期的调用会失败，并反馈在重连后重试。

Agent 拥有其子 Fiber。销毁 Agent 或本产品插件时会等待客户端清理；卸载产品插件也会撤销设备服务注册。工具名称、结果、重连策略和模型可见的服务说明由共享 MCP 实现负责。

<a id="model-experience"></a>
## 模型体验

通过共享 MCP 客户端间接影响模型，已连接的工具定义、结果和服务说明由该客户端管理。

#### KV 缓存影响

连接或服务贡献变化时，工具清单和服务说明会按照上游 MCP 客户端的请求组装逻辑变化。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 本包提供 MCP 能力，不在 Desktop 侧栏嵌入 WDH 浏览器画面，不分发浏览器内核，不安装 ADH / IDH，不迁移旧 Harness 凭据，也不更改设备权限。WDH 目录检查不等同于操作系统沙箱。设备工具沿用原有能力和审批策略。

<a id="dev-note"></a>
### 开发备注

测试启动真实 stdio 夹具进程，检查 Agent 目录隔离、立即拒绝旧目录调用、重连和卸载清理，不连接浏览器或设备。
