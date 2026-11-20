---
description: "Verified official component installations and connection management."
kind: "package-reference"
---

# @deepseek-ai/dsh-decrypthub-components

English | [中文](README.zh.md)

`inspectTargets` runs the verified component CLI with `status --json`, a deadline, and bounded stdout. The snapshot retains the observation time and reports unsupported or failed CLIs explicitly. Device status reads never change configuration or target processes.

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

The capture panel reads only the connection already owned by its chat. A capture list carries the WDH process identity alongside each request ID. The detail read presents the selected response and initiating frames together, or returns an expired selection when the owning process changed or removed the record.

`importPreview` and `importRun` copy the conversations of a selected official Harness home into this product home, and nothing else. Conversations are the only stable interchange unit: the session JSONL format is versioned with an explicit migration contract. Sessions are copied one `<projectKey>/<sessionId>` directory at a time, only memberships whose stored log exists are adopted, and sessions whose physical compression differs from the destination root are skipped with a count. The projection cache is copied for the imported sessions so their titles survive; the JSON workspace fallback is rewritten through a temporary file. Tasks, model credentials and plugins are intentionally not imported: they are internal versioned files whose version skew would break the destination, and a plugin bundle needs a real installation path rather than a file copy.

<a id="understand-the-implementation"></a>
## Understand the implementation

DSH MCP clients own connection lifetimes and Settings checks write revisions. Presentation uses observed facts. Cancellation, disposal and reconnect release the corresponding subscriptions or processes.

The owner can select an online Android or iOS app from a configured device in the chat. The Host stores the selected address and original process identity by session ID through the configured storage domain. Saving or clearing a selection survives a restart. Status reads verify the original process. An unreachable service leaves the selection unverified, and a changed process requires reselection.

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
- **Harness import copies conversations only** — tasks, model credentials and plugins are not imported; the import page exposes one conversation category, while model routing, automation and plugins stay on their own pages.
- **One log compression per destination** — plaintext and Zstandard generations cannot share a session root; the import skips the incompatible side instead of breaking the destination backend, and the result reports how many sessions were skipped.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintenance context</summary>

Keep the user’s running installation fixed; validate with isolated application data.

</details>
