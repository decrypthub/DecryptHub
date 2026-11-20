---
description: "Connect WDH per session and manage optional device MCP servers."
kind: "package-reference"
---

# @deepseek-ai/dsh-decrypthub-integrations

English | [中文](README.zh.md)

The model-facing `decrypthub_status` tool queries fresh official CLI observations before target selection. Installation, MCP connectivity, service liveness, and online target identity remain separate. Multiple matching targets require user selection; the read never injects or restarts an app.

## Summary

The plugin uses the shared MCP client and manager. Installing WDH prepares tools for open chats, and opening a new chat prepares its connection before the first model request. ADH and IDH remain disabled until configured.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The product Web bundle mounts this plugin. Packaged Desktop supplies the installed WDH entry and its private data directory. Standalone Web deployments set `DSH_WDH_ENTRY` and `DSH_WDH_DATA_DIR` to absolute paths. The product bundle selects `wdh.browser: cloak`; install that kernel independently before browser use. The standalone plugin schema defaults to `system` for other compositions.

In Desktop chat, ask the Agent to add an MCP server from a repository link with documented setup instructions, a Streamable HTTP endpoint, a local command, or an MCP JSON entry. The confirmation shows the proposed configuration. Approving saves and enables it for the Desktop profile, then waits for tool discovery on the live connection. An unconfirmed connection stays visible in Skills & MCP with its actual status. Pre-existing names cannot be overwritten from chat.

The plugin settings expose `adh` and `idh` with `enabled`, `command`, and `args` fields. Their defaults are disabled, executable names `adh` / `idh`, and arguments `[mcp]`. Enabling one registers it with the upstream MCP manager, which owns connection status, restart, tool discovery, credential scrubbing, and process cleanup. This package never reads a device credential or attaches to a device itself.

`startupTimeoutMs`, `closeTimeoutMs`, and `toolCallTimeoutMs` default to 10000, 5000, and 60000 milliseconds. A managed WDH installation supplies its entry path, or an operator may set an absolute `entry`. WDH stores data in the configured absolute `dataDirectory` or under `DSH_HOME`. The plugin waits for an installed entry before connecting.

<a id="understand-the-implementation"></a>
## Understand the implementation

Every Agent gets a distinct WDH client and a data directory derived from its identity and working directory. Before the next step, a directory change closes the old client before mounting its replacement. A final tool guard also refuses old-directory WDH tool and resource calls within an already admitted step. Calls already dispatched retain the upstream cancellation behavior. Unconfirmed closure blocks replacement and requires an application restart.

WDH tools appear as `mcp__wdh__*`; enabled device servers use `mcp__adh__*` and `mcp__idh__*`. Calls and results use upstream MCP transcript events. The plugin injects no additional model instructions or unlogged context. A stale workspace call fails with corrective feedback to retry after reconnection.

The Agent owns its child Fiber. Disposing the Agent or this product plugin drains its client; unloading the product plugin also removes device-server registrations. The shared MCP implementation owns tool names, results, reconnect policy, and model-visible server instructions.

<a id="model-experience"></a>
## Model Experience

### Device status and connected tools

#### What the model sees

When a chat has a selected device and app, `decrypthub_status` reports the selection and the original process's validity. The selection remains read-only after restart and while awaiting reselection. An unbound chat gets the component inventory and the configured endpoints. WDH uses the current Agent's browser connection.

#### Token effect

This plugin registers `decrypthub_status` and, on Desktop with editable settings and user questions, `mcp_add`. The tools use the normal transcript pipeline. `mcp_add` returns the live tool count, and the next step receives the newly registered schemas. Credentials are supplied as references to stored values. The shared MCP client owns connected tool registrations and instructions. WDH uses one Agent-owned connection for browser operations.

#### KV Cache effect

The management schemas stay stable. Tool results append observations to the session. Connected tool inventories and instructions change when their server contributions change, following the upstream MCP client's request assembly.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- This package exposes MCP capabilities. It does not embed WDH browser frames in the Desktop side panel, distribute browser kernels, install ADH / IDH, migrate old Harness credentials, or change device permissions. WDH directory checks do not provide an operating-system sandbox. Device tools retain their existing capabilities and approval policies.

<a id="dev-note"></a>
### Dev Note

Tests start real stdio fixture processes to check independent Agent directories, immediate stale-directory refusal, reconnection, and unload cleanup without connecting to a browser or device.
