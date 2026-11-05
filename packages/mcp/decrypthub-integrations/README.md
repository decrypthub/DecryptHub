---
description: "Connect WDH per session and manage optional device MCP servers."
kind: "package-reference"
---

# @deepseek-ai/dsh-decrypthub-integrations

English | [中文](README.zh.md)

## Summary

This DecryptHub product plugin composes the upstream MCP client and manager. It adds no replacement conversation, input, automation, or tool-card UI. WDH starts on the first Agent step; ADH and IDH remain disabled until configured.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The product Web bundle mounts this plugin. Packaged Desktop supplies the installed WDH entry and its private data directory. Standalone Web deployments set `DSH_WDH_ENTRY` and `DSH_WDH_DATA_DIR` to absolute paths. The product bundle selects `wdh.browser: cloak`; install that kernel independently before browser use. The standalone plugin schema defaults to `system` for other compositions.

The plugin settings expose `adh` and `idh` with `enabled`, `command`, and `args` fields. Their defaults are disabled, executable names `adh` / `idh`, and arguments `[mcp]`. Enabling one registers it with the upstream MCP manager, which owns connection status, restart, tool discovery, credential scrubbing, and process cleanup. This package never reads a device credential or attaches to a device itself.

`startupTimeoutMs`, `closeTimeoutMs`, and `toolCallTimeoutMs` default to 10000, 5000, and 60000 milliseconds. WDH requires absolute `entry` and `dataDirectory` paths when enabled; invalid paths reject plugin activation. Missing executables and unavailable servers follow the upstream MCP failure reporting.

<a id="understand-the-implementation"></a>
## Understand the implementation

Every Agent gets a distinct WDH client and a data directory derived from its identity and working directory. Before the next step, a directory change closes the old client before mounting its replacement. A final tool guard also refuses old-directory WDH tool and resource calls within an already admitted step. Calls already dispatched retain the upstream cancellation behavior. Unconfirmed closure blocks replacement and requires an application restart.

WDH tools appear as `mcp__wdh__*`; enabled device servers use `mcp__adh__*` and `mcp__idh__*`. Calls and results use upstream MCP transcript events. The plugin injects no additional model instructions or unlogged context. A stale workspace call fails with corrective feedback to retry after reconnection.

The Agent owns its child Fiber. Disposing the Agent or this product plugin drains its client; unloading the product plugin also removes device-server registrations. The shared MCP implementation owns tool names, results, reconnect policy, and model-visible server instructions.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the shared MCP client, which owns the connected tool schemas, results, and server instructions.

#### KV Cache effect

Tool inventories and server instructions change when their connections or server contributions change, following the upstream MCP client's request assembly.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- This package exposes MCP capabilities. It does not embed WDH browser frames in the Desktop side panel, distribute browser kernels, install ADH / IDH, migrate old Harness credentials, or change device permissions. WDH directory checks do not provide an operating-system sandbox. Device tools retain their existing capabilities and approval policies.

<a id="dev-note"></a>
### Dev Note

Tests start real stdio fixture processes to check independent Agent directories, immediate stale-directory refusal, reconnection, and unload cleanup without connecting to a browser or device.
