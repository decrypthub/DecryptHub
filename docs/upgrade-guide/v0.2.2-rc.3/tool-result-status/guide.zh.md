---
kind: upgrade-guide
description: "共享 MCP 资源工具要求存在可用的资源提供方，Native 前台 PowerShell 命令失败时返回结构化错误。"
---

# MCP 可用性与 PowerShell 命令状态

[English](guide.md) | 中文

## 变更

过去启用 MCP 配置后就会显示共享资源工具。现在，共享资源工具随已连接且声明支持资源的提供方启用。`mcp_server_status` 读取已配置服务器的连接状态，无需向服务器发送请求。

过去 Native 模型步骤中前台 `pwsh` 命令的非零退出会记录为工具调用成功，并附退出码标记。现在，这类退出会记录 `PWSH_NONZERO_EXIT`，同时保留终端输出和退出码。编程调用和嵌套调用仍返回进程结果。

## 迁移

1. 服务器工具缺失时，先用 `mcp_server_status` 检查。服务器已连接且报告支持资源时，再调用 `list_mcp_resources`。
2. 若程序会读取聊天中 Native `pwsh` 的回执，请将 `PWSH_NONZERO_EXIT` 视为命令失败并保留终端输出。依次运行一条非零退出和一条成功的命令验证。
