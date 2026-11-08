---
description: "Model-facing session history: list recent sessions with titles and timestamps."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-product-sessions

English | [中文](README.zh.md)

## Summary

Adds one read-only tool, `session_list`, that reports the most recently updated sessions in the workspace with their ids, titles, and update times. It reads through the shared `ctx.sessionQuery` service, so the listing follows the same live-preferred corpus the rest of the product uses and never opens a session of its own.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>

## Use this package

Mount the plugin in a composition that provides `sessionQuery`. `maxSessions` caps how many sessions one call may return; the tool's `limit` argument narrows that further but cannot exceed it.

<a id="model-experience"></a>

## Model Experience

### session list

#### What the model sees

One `session_list` schema with an optional `limit`, and one line per session in the result: `updatedAt id title`. The description tells the model to call it when the user refers to earlier work and the session holding it is unknown.

#### Token effect

The tool costs a small constant schema per request. Each listed session costs roughly one line, which is why the configured cap defaults to twenty rather than listing everything.

#### KV Cache effect

The schema and its position are stable, so the prompt prefix stays cacheable. Listing sessions adds only tool-result history, which appends without rewriting earlier messages.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No content search** — the tool lists sessions but does not search inside them; full-text search needs the SQLite session-query backend and a product tool for it.
- **Titles are best effort** — a session without a generated title reports an empty string, so the model must fall back to the id.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The upstream `dsh-tool-session-query` package already covers search and event reads, but it lives in `packages/experimental`, and a release bundle must not depend on an experimental package. This package is the product-owned subset that may ship in the default composition.

</details>
