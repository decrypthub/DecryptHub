---
description: "Scoped product memory injected into the system prompt and editable by the model."
kind: "package-reference"
---

# @deepseek-ai/dsh-product-memory

English | [中文](README.zh.md)

## Summary

Stores durable facts in this plugin's settings namespace, injects the entries as one system-prompt section bounded by `maxSectionChars`, and exposes `memory_write`, `memory_list`, and `memory_delete` to the model. Entries carry a `user` or `project` scope and ISO-8601 timestamps; the namespace owns durability, so entries survive restarts without writing session events.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>

## Use this package

Mount the plugin in a profile composition that provides the settings service. It registers section `product-memory` at order 150 and the three tools; `maxSectionChars` bounds the injected text.

<a id="model-experience"></a>

## Model Experience

### memory tools

#### What the model sees

One injected section lists `(scope) text [id]` per entry, bounded by `maxSectionChars`, plus three tool schemas: `memory_write`, `memory_list`, `memory_delete`. Ids appear in the section so the model can update or delete an entry without reading first.

#### Token effect

An empty memory injects nothing. A populated memory costs one line per entry in every request, so entries stay one sentence. Tool results are one short line each.

#### KV Cache effect

The section text changes whenever an entry changes, which invalidates the cache from that section onward. Keeping entries short and writes infrequent preserves more cache.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Generated page unverified** — `settings.describe()` exposes the namespace with `autoGenerate: true` in unit composition, but rendering inside the packaged Desktop app is not verified end to end; manual checks showed only the account section. A product-owned `ui-decrypthub-settings` page is the fallback if the generated form cannot express the entry dictionary.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Entries are keyed by id so one write touches one path and array index shifts cannot misplace entries. The model and the settings page share one namespace, so writes go through `ctx.settings.mutate` to keep the revision check.

</details>
