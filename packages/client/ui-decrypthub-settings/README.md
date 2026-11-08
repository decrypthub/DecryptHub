---
description: "Product settings sections for memory and the role definition, over their settings namespaces."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-decrypthub-settings

English | [中文](README.zh.md)

## Summary

Contributes two `settings.section` entries. The memory section lists, adds, and removes `product-memory` entries; the role section edits the `product-persona` text. Both read and write through `ctx.remote.settings`, so the pages, the settings document, and the agent's own tools edit one durable source with one revision check.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>

## Use this package

Mount the plugin in a profile whose Host serves both namespaces. It contributes no host code; the browser half registers sections `memory` (order 26) and `persona` (order 27) with their dictionaries.

<a id="model-experience"></a>

## Model Experience

### product settings sections

#### What the model sees

Both sections write namespaces the model already reads: an entry added here appears in the injected `product-memory` section, and role text edited here becomes the `product-persona` prompt section on the next request.

#### Token effect

The pages add no prompt tokens of their own. Each saved memory entry costs one line per request; role text costs its full length every request.

#### KV Cache effect

Saving either page changes the injected prompt text, which invalidates cache from the changed section onward. Role text sits near the head, so editing it costs the whole prompt cache.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No per-entry edit form** — memory entries are added and removed; editing reuses the agent's `memory_write` with an existing id.
- **Single global role** — the role section edits the deployment-wide definition, not a per-session persona.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The Host half must export `apply()`; a package whose node entry exports nothing is dropped from the client roster without an error, so its settings sections never register. Writes always send the revision read with the last `describe()` so a concurrent agent write fails the page save instead of silently overwriting it.

</details>
