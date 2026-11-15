---
description: "Product settings for memory as the host surface, with the role definition swapped in place from a header action over their settings namespaces."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-decrypthub-settings

English | [中文](README.zh.md)

## Summary

Contributes one `settings.section` entry and matching main-panel surface. Memory is the host catalog; Set role swaps to the role editor in the same surface, with Back to memory. The memory catalog lists, searches, adds, edits, and removes `product-memory` entries; the role view edits the `product-persona` text. Both read and write through `ctx.remote.settings`, so the pages, the settings document, and the agent's own tools edit one durable source with one revision check. Creation prefers asking the agent in a session, with a manual editor as the alternate path.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>

## Use this package

Mount the plugin in a profile whose Host serves both namespaces. It contributes no host code; the browser half registers the fused section `memory-persona` (order 26), the sidebar entry "Memory & role", and their dictionaries. The memory and role pages call `uiWorkspace.startSession` when the user chooses the agent path.

<a id="model-experience"></a>

## Model Experience

### product settings sections

#### What the model sees

Both sections write namespaces the model already reads: an entry added here appears in the injected `product-memory` section, and role text edited here becomes the `product-persona` prompt section on the next request. Choosing “Ask the agent” opens a session with a localized draft prompt; the model then uses its memory or ordinary reply tools.

#### Token effect

The pages add no prompt tokens of their own. Each saved memory entry costs one line per request; role text costs its full length every request.

#### KV Cache effect

Saving either page changes the injected prompt text, which invalidates cache from the changed section onward. Role text sits near the head, so editing it costs the whole prompt cache.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Single global role** — the role section edits the deployment-wide definition, not a per-session persona.
- **No system-memory viewer** — read-only product and plugin environment instructions still await a dedicated surface.
- **New entries are cross-project only** — the page has no workspace to bind, so the project scope is disabled while creating; workspace memories are written by the agent inside a conversation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The Host half must export `apply()`; a package whose node entry exports nothing is dropped from the client roster without an error, so its settings sections never register. Writes always send the revision read with the last `describe()`, and the plugin reloads both namespaces on `settings/document-updated`, so an agent write made in another session reaches the open page instead of leaving a stale revision behind. The catalog chrome mirrors the automation-tasks page: heading actions, scope chips, search, list rows, and a detail pane.

</details>
