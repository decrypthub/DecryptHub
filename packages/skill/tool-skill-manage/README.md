---
description: "Model-facing skill authoring: create, list, and delete skills under the product skill root."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-skill-manage

English | [中文](README.zh.md)

## Summary

Gives the model three tools over one writable skill root: `skill_create` writes `<name>/SKILL.md` with frontmatter, `skill_list` reads the stored bundles, and `skill_delete` removes one. The same directory is mounted as a `skill-filesystem` root, so an authored skill reaches the next step's catalog through the upstream watcher instead of a private code path.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>

## Use this package

Mount the plugin with `directory` pointing at the writable root, and give `dsh-skill-filesystem` the same directory under `roots`. Names are kebab-case so the directory, catalog id, and `/name` invocation agree; a create without `overwrite` refuses to replace an existing skill.

<a id="model-experience"></a>

## Model Experience

### skill tools

#### What the model sees

Three tool schemas: `skill_create` (name, description, body, optional overwrite), `skill_list` (no arguments), and `skill_delete` (name). Descriptions state when to use each, and results are one short line naming the stored path or the removal outcome.

#### Token effect

Each schema is small and constant. Results stay one line, so authoring a skill costs little context; the skill body itself only reaches the prompt when the skill is loaded.

#### KV Cache effect

Creating a skill appends a catalog entry, which changes the injected catalog section and invalidates cache from that section onward. Deleting one does the same, so batching authoring into one step preserves more cache.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Whole-file replace only** — `skill_create` with `overwrite` replaces the body rather than patching it, so the model must resend the full instructions.
- **No invocation policy yet** — authored skills are model- and user-invocable; frontmatter fields such as `disable-model-invocation` are not exposed through the tools.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The tool writes plain files rather than registering runtime skills, so the catalog stays whatever `dsh-skill-filesystem` discovers and a restart cannot lose an authored skill. Keep the frontmatter limited to `name` and `description` until the parser contract grows.

</details>
