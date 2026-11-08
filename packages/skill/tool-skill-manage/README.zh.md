---
description: "面向模型的技能编写工具：在产品技能根目录下创建、列出与删除技能。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-skill-manage

[English](README.md) | 中文

## 摘要

为模型提供三个工具：`skill_create` 写入带 frontmatter 的 `<name>/SKILL.md`，`skill_list` 读取已存技能，`skill_delete` 删除其一。同一目录同时作为 `skill-filesystem` 的 root 挂载，因此写入的技能通过上游 watcher 进入下一步的目录，而不是走私有通路。

## 目录

- [使用本包](#use-this-package)
- [Model Experience](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>

## 使用本包

挂载本插件并把 `directory` 指向可写根目录，同时把同一目录配置到 `dsh-skill-filesystem` 的 `roots`。名称使用 kebab-case，使目录名、目录 id 与 `/name` 调用保持一致；不带 `overwrite` 的创建不会覆盖已有技能。

<a id="model-experience"></a>

## Model Experience

### skill tools

#### What the model sees

三个工具 schema：`skill_create`（name、description、body、可选 overwrite）、`skill_list`（无参数）、`skill_delete`（name）。描述写明各自的使用时机，结果为一行短文本，指明写入路径或删除结果。

#### Token effect

每个 schema 都很小且固定。结果只有一行，因此编写技能消耗的上下文很少；技能正文只在该技能被加载时才进入提示词。

#### KV Cache effect

创建技能会追加一条目录条目，改变注入的目录片段，使该片段之后的前缀缓存失效；删除同理。把编写集中在同一步可减少缓存失效。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

- **只支持整文件替换** — 带 `overwrite` 的 `skill_create` 会替换正文而非增量修改，模型必须重发完整指令。
- **暂未暴露调用策略** — 写出的技能默认可被模型与用户调用，`disable-model-invocation` 等 frontmatter 字段尚未通过工具开放。

<a id="dev-note"></a>
### 开发注记

<details>
<summary>维护者工作上下文 — 点击展开</summary>

工具写的是普通文件而非运行时注册，因此目录内容仍由 `dsh-skill-filesystem` 决定，重启不会丢失已编写的技能。在解析契约扩展之前，frontmatter 只保留 `name` 与 `description`。

</details>
