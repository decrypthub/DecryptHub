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
- [Model Experience](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>

## 使用本包

在 profile 组合中挂载该插件。它注入 `tools`，并注册参数为空的 `product_runtime` 工具。

<a id="model-experience"></a>

## Model Experience

### product_runtime

#### What the model sees

一个名为 `product_runtime`、无参数的工具，结果含 `product`、`home`、`platform`、`node` 四个字段。描述指示模型在用户询问版本或运行环境时调用。渲染结果是一行事实加 Harness 主目录。

#### Token effect

schema 不带参数，每次请求只占少量固定 token。结果是单行短文本，通常几十个 token。

#### KV Cache effect

工具在列表中的位置稳定，schema 前缀可跨步骤命中缓存。schema 与描述不随会话变化。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

- **仅进程级事实** — 尚未暴露构建版本等元数据，因为 Host 没有把这类信息传入插件环境。

<a id="dev-note"></a>
### 开发注记

<details>
<summary>维护者工作上下文 — 点击展开</summary>

结果字段只应增加：模型按名读取字段，删除字段会静默降低运行时回答的准确性。

</details>
