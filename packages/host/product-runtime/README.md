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

<a id="use-this-package"></a>

## Use this package

Mount the plugin in a profile composition. It injects `tools` and registers `product_runtime` with an empty parameter object.

<a id="model-experience"></a>

## Model Experience

The tool exposes four result fields: `product`, `home`, `platform`, and `node`. Its description tells the model to call it when the user asks which build or environment the agent runs in. The rendered text is one line of facts plus the harness home, so the transcript stays readable.
