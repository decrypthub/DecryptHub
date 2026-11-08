---
description: "Report the running DecryptHub product runtime to the model."
kind: "package-reference"
---

# @deepseek-ai/dsh-product-runtime

English | [中文](README.zh.md)

## Summary

Registers one built-in tool that answers which product, harness home, platform, and Node version the running Host serves. The tool reads no service and no session state: it reports process-level facts, so it stays valid in every profile that mounts it.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>

## Use this package

Mount the plugin in a profile composition. It injects `tools` and registers `product_runtime` with an empty parameter object.

<a id="model-experience"></a>

## Model Experience

### product_runtime

#### What the model sees

One tool named `product_runtime` with no parameters and four result fields: `product`, `home`, `platform`, `node`. The description tells the model to call it when the user asks which build or environment the agent runs in. The rendered result is one line of facts plus the harness home.

#### Token effect

The schema carries no parameters, so it costs a constant handful of tokens per request. A result is one short line, usually a few dozen tokens.

#### KV Cache effect

The tool list position is stable, so the schema prefix stays cacheable across steps. Nothing in the schema or description varies per session.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Process facts only** — build metadata such as the installed version is not exposed, because the Host does not pass it into the plugin environment.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Keep the result fields additive: the model reads them by name, and a removed field silently degrades runtime answers.

</details>
