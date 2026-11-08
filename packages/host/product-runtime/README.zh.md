---
description: "向模型报告当前运行的 DecryptHub 产品运行时。"
kind: "package-reference"
---

# @deepseek-ai/dsh-product-runtime

[English](README.md) | 中文

## 摘要

注册一个内置工具，回答当前 Host 服务的产品名、Harness 主目录、平台和 Node 版本。该工具不读取服务或会话状态，只报告进程级事实，因此在任何挂载它的 profile 中都成立。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)

<a id="use-this-package"></a>

## 使用本包

在 profile 组合中挂载该插件。它注入 `tools`，并注册参数为空的 `product_runtime` 工具。

<a id="model-experience"></a>

## 模型体验

工具返回 `product`、`home`、`platform`、`node` 四个字段，描述指示模型在用户询问版本或运行环境时调用。渲染结果是一行事实加 Harness 主目录，保持对话记录可读。
