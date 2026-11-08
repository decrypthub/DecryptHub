---
description: "User-editable role definition injected as a system-prompt section."
kind: "package-reference"
---

# @deepseek-ai/dsh-product-persona

English | [中文](README.zh.md)

## Summary

Stores one role definition in the `product-persona` settings namespace and injects it as a system-prompt section at order 20, after the harness identity and before workspace guidance. Empty text contributes nothing, and `interpolate: false` keeps the text literal so a role that mentions `{{variables}}` is not rewritten. The settings namespace is also the page surface, so a user edit and a deployment default write the same field.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>

## Use this package

Mount the plugin in a profile that provides the settings service. Configure `persona` with the role text; the section re-reads the namespace after `loader/volatile-update`, so edits apply without a restart.

<a id="model-experience"></a>

## Model Experience

### role section

#### What the model sees

One `product-persona` prompt section carrying the configured role text verbatim at the top of the prompt, followed by the remaining sections in their own order. An empty value removes the section entirely.

#### Token effect

The cost is exactly the configured text, paid on every request. Long role definitions therefore belong in a preset or a skill rather than here.

#### KV Cache effect

Because the section sits near the prompt head, changing it invalidates the cache for the whole prompt. Keep edits deliberate and infrequent.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **One global value** — the definition applies to every session in the profile; per-session roles still need `dsh-persona` inside an agent preset.
- **No variable interpolation** — role text is literal, so it cannot reference prompt variables.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Order 20 is deliberate: the harness identity stays first, and workspace guidance from `dsh-agent-instructions` still follows the role. Mounting this row globally does not collide with the preset persona because that package registers per-agent sections.

</details>
