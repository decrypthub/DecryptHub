---
description: "Default-on skill management and MCP configuration with their management page."
kind: "package-bundle"
---

# @deepseek-ai/dsh-mcp-bundle

English | [中文](README.zh.md)

## Summary

DecryptHub ships this bundle in the default Web and Desktop profiles so skill management and MCP configuration stay available without a separate install. It appears on the Plugins page as a built-in official entry. Switching it off removes the skill tools and the Skills and MCP management page from the profile.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Open **Plugins** and find **Skills and MCP** in the official list. It starts enabled with the Web and Desktop profiles. Use the Skills and MCP sidebar page for custom servers, official components, and skill inventory. Switch the bundle off only when those product surfaces should leave the profile.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details</summary>

[`cordis.patch.yml`](cordis.patch.yml) inserts `tool-skill-manage` and `ui-mcp`. The shared MCP manager stays in `@deepseek-ai/dsh-web-app`. The bundle is listed in `PROFILE_TEMPLATES.web` and `EXTENSION_BUNDLES`, not in `OPTIONAL_BUNDLES`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

[Skill manage tool](../../skill/tool-skill-manage/README.md) · [MCP UI](../../client/ui-mcp/README.md)

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through skill management tools that let the model create, list, and delete skills under the configured skills root.

#### KV Cache effect

The layer adds no request content directly; the mounted skill tools own cache effects from tool catalogs and results.

## Known Limitations and Deferred Work

- Disabling the bundle removes skill tools and the MCP management page together; the shared MCP manager in the web composition remains.
