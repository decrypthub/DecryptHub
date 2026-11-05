---
description: "Custom MCP and official component management in DecryptHub."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-mcp

English | [中文](README.zh.md)

## Summary

Review and save custom MCP servers, inspect their tools, and manage DecryptHub official components in the existing settings and sidebar. Imports identify conflicts and unsupported transports before saving. Connection settings use revision checks and credential references. Installation, transport and device facts are displayed independently.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The DecryptHub Web bundle mounts this plugin. Open Settings → Custom MCP to add a local command or Streamable HTTP server. Use Import configuration to review mcpServers JSON; conflicting names are skipped. Official components appears in the sidebar and settings. Configure device daemon addresses before enabling ADH or IDH. Browser downloads require explicit license consent.

<a id="understand-the-implementation"></a>
## Understand the implementation

DSH MCP clients own connection lifetimes and Settings checks write revisions. Presentation uses observed facts. Cancellation, disposal and reconnect release the corresponding subscriptions or processes.

<a id="model-experience"></a>
## Model Experience

Indirectly, through MCP configuration and component choices that change connected tools.

#### KV Cache effect

Indirectly, reconnecting may change tool definitions.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- SSE imports are reported as unsupported. Conflicting names must be resolved before importing.
- This build manages WDH tools and browser files; the integrated browser, capture and debugging workbench remains deferred.
- MCP negotiation does not verify a connected Android or iOS target.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintenance context</summary>

Keep the user’s running installation fixed; validate with isolated application data.

</details>
