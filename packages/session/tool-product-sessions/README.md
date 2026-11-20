---
description: "Model-facing session history: list recent sessions with titles and timestamps."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-product-sessions

English | [中文](README.zh.md)

## Summary

Adds two read-only tools: `session_list` reports the newest-created sessions of the calling workspace with their ids, titles, and creation times, and `session_read` returns the trailing user and assistant messages of one session in that workspace. Both read through the shared `ctx.sessionQuery` service, so they follow the same live-preferred corpus the rest of the product uses and never open a session of their own.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>

## Use this package

Mount the plugin with `sessionQuery` and the workspace registry. Both tools require the caller's session to belong to a registered workspace. Lists and transcript reads use that workspace's recorded session membership. `maxSessions` caps the result, and `limit` can request fewer sessions.

<a id="model-experience"></a>

## Model Experience

### session tools

#### What the model sees

Two schemas: `session_list` with an optional `limit`, and `session_read` with a required `id` and an optional `limit`. List results are one line per session (`createdAt id title`); read results are one line per message (`role: text`) taken from the stored user and assistant events, with tool traffic omitted. The descriptions tell the model to call them when the user refers to earlier work whose session is unknown.

#### Token effect

The tool costs a small constant schema per request. Each listed session costs roughly one line, which is why the configured cap defaults to twenty rather than listing everything.

#### KV Cache effect

The schema and its position are stable, so the prompt prefix stays cacheable. Listing sessions adds only tool-result history, which appends without rewriting earlier messages.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No content search** — the tools list sessions and read their trailing messages but do not search across them; full-text search needs the SQLite session-query backend and a product tool for it.
- **Titles are best effort** — a session without a generated title reports an empty string, so the model must fall back to the id.
- **Creation time only** — the stored header records creation, not last activity, so the listing is newest-created order rather than most-recently-active order.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The upstream `dsh-tool-session-query` package already covers search and event reads, but it lives in `packages/experimental`, and a release bundle must not depend on an experimental package. This package is the product-owned subset that may ship in the default composition. The reader reconstructs messages from the durable event payloads (`user/message`, `assistant/message`) instead of a synthesized field, so it works on imported legacy generations after their first migration.

</details>
