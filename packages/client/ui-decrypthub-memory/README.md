---
description: "Product memory settings section over the product-memory namespace."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-decrypthub-memory

English | [中文](README.zh.md)

## Summary

Adds one `settings.section` entry that lists, adds, and removes product memory entries. It reads and writes the host's `product-memory` settings namespace through `ctx.remote.settings`, so the page, the settings document, and the agent's memory tools all edit one durable source with one revision check.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>

## Use this package

Mount the plugin in a profile whose Host serves the `product-memory` namespace. It contributes no host code; the browser half registers a settings section with id `memory`, order 26, and the `settings.memory` dictionaries.

<a id="model-experience"></a>

## Model Experience

### memory section

#### What the model sees

Nothing directly: the page writes the same namespace the `memory_*` tools write, so a user edit becomes visible to the model as the injected memory section on the next request.

#### Token effect

The page adds no prompt tokens of its own. An entry added here costs the same one line per request as an entry the model wrote.

#### KV Cache effect

A saved edit changes the injected section text, which invalidates cache from that section onward. Batching several edits into one save keeps fewer cache prefixes on the old text.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No per-entry editing form** — entries are added and removed, not edited in place; editing reuses the agent's `memory_write` with an existing id.
- **No scope filtering** — the list shows `user` and `project` entries together.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The Host half must export `apply()`; a package whose node entry exports nothing is dropped from the client roster without an error, so its settings section never registers. Writes always send the revision read with the last `describe()` so a concurrent agent write fails the page save instead of silently overwriting it. The page reloads after every successful write to keep that revision current.

</details>
