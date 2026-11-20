---
description: "DecryptHub Skills & MCP: MCP|Skills pill tabs; MCP stacks official above custom."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-mcp

English | [中文](README.zh.md)

The device editor provides an explicit status check and shows service liveness separately from the online app list and observation time. Cached observations are not a continuous monitoring guarantee.

## Summary

One sidebar and settings entry, "Skills & MCP", groups official components and custom MCP, with a separate Skills tab. Component cards show observed status and open configuration dialogs. Imports report conflicts and unsupported transports before saving; connection edits use revision checks and credential references. "Import from DSH" copies conversations from a Harness home into this app, grouping them by their original workspace. It imports conversations only.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The DecryptHub Web bundle mounts this plugin. Open Skills & MCP; the MCP tab lists official WDH / ADH / IDH status rows above custom MCP. Opening a row configures install, browser kernel, or device connect. Add a local command or Streamable HTTP server, or import mcpServers JSON after review. Switch to the Skills tab to manage skills. Browser downloads require explicit license consent.

In a chat with WDH connected, open **Browser connected · Capture**. Selecting a recent request shows its response and the JavaScript initiator frames recorded by WDH. Refresh to see new requests or to recover an expired selection.

<a id="understand-the-implementation"></a>
## Understand the implementation

DSH MCP clients own connection lifetimes and Settings checks write revisions. Presentation uses observed facts. Cancellation, disposal and reconnect release the corresponding subscriptions or processes.

Desktop chat renders the proposed MCP configuration through the shared approval card. Add and connect answers the current request once, and Cancel leaves configuration untouched.

<a id="model-experience"></a>
## Model Experience

Indirectly, through MCP configuration and component choices that change connected tools.

#### KV Cache effect

Indirectly, reconnecting may change tool definitions.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- SSE imports are reported as unsupported. Conflicting names must be resolved before importing.
- The Harness import copies conversations only: tasks, model keys and plugins are intentionally not imported, and the skills catalog resolves from the newest conversation, so a home without conversations shows an explanatory empty state.
- MCP negotiation does not verify a connected Android or iOS target.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintenance context</summary>

Keep the user’s running installation fixed; validate with isolated application data.

</details>
