---
kind: upgrade-guide
description: "Shared MCP resource tools require an available resource provider, and native foreground PowerShell failures carry a structured error."
---

# MCP availability and PowerShell command status

English | [中文](guide.zh.md)

## Change

An active MCP configuration previously exposed the shared resource tools. Their availability now follows the connected providers that advertise resources. `mcp_server_status` reads the configured server's connection state without sending a request to it.

A native model step previously recorded non-zero foreground `pwsh` exits as successful tool calls with an exit-code marker. These exits now record `PWSH_NONZERO_EXIT` with terminal output and the exit code. Programmatic and nested calls continue to return the process value.

## Migration

1. Use `mcp_server_status` before discovering resources when a server's tools are absent. Call `list_mcp_resources` only when the server is connected and reports resource support.
2. If a transcript consumer reads native `pwsh` results, handle `PWSH_NONZERO_EXIT` as a command failure and retain its terminal output. Verify with a command that exits non-zero followed by a separate command that succeeds.
