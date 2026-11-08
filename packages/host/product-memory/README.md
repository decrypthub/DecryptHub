---
description: "Scoped product memory injected into the system prompt and editable by the model."
kind: "package-reference"
---

# @deepseek-ai/dsh-product-memory

English | [中文](README.zh.md)

## Summary

Stores durable facts in one `product_memory` storage domain, injects the stored entries as a single system-prompt section bounded by `maxSectionChars`, and exposes `memory_write`, `memory_list`, and `memory_delete` to the model. Entries carry a `user` or `project` scope and ISO-8601 timestamps; the domain owns durability, so entries survive restarts without writing session events.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)

<a id="use-this-package"></a>

## Use this package

Mount the plugin in a profile composition with a storage backend. It opens `product_memory` on first apply, registers section `product_memory` at order 150, and registers the three tools. Configure `maxSectionChars` to bound the injected text.

<a id="model-experience"></a>

## Model Experience

The model sees one injected section listing `(scope) text [id]` lines, plus three tool schemas. Listing ids in the section lets the model update or delete an entry in a later turn without an extra read. The section is skipped entirely when nothing is stored, so an empty memory costs no prompt tokens. Tool results are one short line each.
