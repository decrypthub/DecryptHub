---
description: "Verified official component installations and connection management."
kind: "package-reference"
---

# @deepseek-ai/dsh-decrypthub-components

English | [中文](README.zh.md)

## Summary

Inspect WDH, ADH and IDH availability, check official releases, and activate verified component versions. Downloads have size limits and SHA-256 verification; archives reject links and unsafe paths. Failed or cancelled installation retains the previous active version. Device connections use separately configured daemon addresses.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The DecryptHub Web composition mounts this owner-only Remote service with an absolute component directory. Optional bundledWdhEntry points to the packaged WDH CLI. The official components page requests snapshots, reviewed installs, cancellation, rollback, browser inspection and revision-checked connection settings. No catalog request occurs until the user checks for updates.

<a id="understand-the-implementation"></a>
## Understand the implementation

DSH MCP clients own connection lifetimes and Settings checks write revisions. Presentation uses observed facts. Cancellation, disposal and reconnect release the corresponding subscriptions or processes.

<a id="model-experience"></a>
## Model Experience

Indirectly, through verified component versions selected by the MCP integration provider.

#### KV Cache effect

Indirectly, reconnecting may change tool definitions.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Only code-owned DecryptHub repositories and compatible archives with published SHA-256 digests can install.
- Managed device runtimes require Python 3.10 or newer. Device authorization and live target verification are not performed by this service.
- Download and device behavior still require verification against actual releases and supported devices.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintenance context</summary>

Keep the user’s running installation fixed; validate with isolated application data.

</details>
