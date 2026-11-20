---
description: "Scoped product memory injected into the system prompt and editable by the model."
kind: "package-reference"
---

# @deepseek-ai/dsh-product-memory

English | [中文](README.zh.md)

## Summary

Stores durable facts in this plugin's settings namespace, injects them as two system-prompt sections bounded by `maxSectionChars`, and exposes `memory_write`, `memory_list`, and `memory_delete` to the model. Entries carry a `user` or `project` scope and ISO-8601 timestamps. `user` entries are injected globally; `project` entries are injected only into the agents of the workspace that wrote them (the entry stores that workspace). The namespace owns durability, so entries survive restarts without writing session events.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>

## Use this package

Mount the plugin in a profile with settings. The workspace registry supplies the session membership needed for project memory. Project entries store the workspace ID. `maxSectionChars` bounds each of the two system-prompt sections.

<a id="model-experience"></a>

## Model Experience

### memory tools

#### What the model sees

The model receives `(user) text [id]` for global entries and a separate section for entries in its session's workspace. `memory_list`, `memory_write` updates, and `memory_delete` use the same visibility checks as prompt assembly. Updating a memory by ID preserves its scope.

#### Token effect

An empty memory injects nothing. A populated memory costs one line per entry in every request, so entries stay one sentence. Tool results are one short line each.

#### KV Cache effect

The section text changes whenever an entry changes, which invalidates the cache from that section onward. Keeping entries short and writes infrequent preserves more cache. Cross-project entries sit in one stable section; workspace entries only rewrite the per-agent section of that workspace.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Generated page unverified** — `settings.describe()` exposes the namespace with `autoGenerate: true` in unit composition, but rendering inside the packaged Desktop app is not verified end to end; manual checks showed only the account section. A product-owned `ui-decrypthub-settings` page is the fallback if the generated form cannot express the entry dictionary.
- **Legacy project entries.** A directory-only entry remains visible to members of the matching workspace if that registration already existed when the entry was created. An update records the workspace ID. Settings retains entries whose ownership cannot be confirmed. Review them there and save project facts from a chat in the intended workspace.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Entries are keyed by id so one write touches one path and array index shifts cannot misplace entries. The model and the settings page share one namespace, so writes go through `ctx.settings.mutate` to keep the revision check.

</details>
