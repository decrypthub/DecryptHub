---
description: "Default-on product memory and role definition with their management page."
kind: "package-bundle"
---

# @deepseek-ai/dsh-memory-bundle

English | [中文](README.zh.md)

## Summary

DecryptHub ships this bundle in the default Web and Desktop profiles so product memory and the role definition stay available without a separate install. It appears on the Plugins page as a built-in official entry. Switching it off removes the memory and role host rows and their management page from the profile.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Open **Plugins** and find **Memory and role** in the official list. It starts enabled with the Web and Desktop profiles. Use the Memory and role sidebar page to edit entries and the role text. Switch the bundle off only when those product surfaces should leave the profile.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details</summary>

[`cordis.patch.yml`](cordis.patch.yml) inserts `product-memory`, `product-persona`, and `ui-decrypthub-settings`. The bundle is listed in `PROFILE_TEMPLATES.web` and `EXTENSION_BUNDLES`, not in `OPTIONAL_BUNDLES`. The plugin page treats `EXTENSION_BUNDLES` as official so a default-on installation bundle stays visible without overlapping the optional catalog.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

[Product memory](../../host/product-memory/README.md) · [Product persona](../../host/product-persona/README.md) · [DecryptHub settings UI](../../client/ui-decrypthub-settings/README.md)

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through product memory and persona, which inject editable settings into the system prompt and expose memory tools.

#### KV Cache effect

The layer adds no request content directly; the mounted host packages own cache effects from prompt sections and tools.

## Known Limitations and Deferred Work

- Disabling the bundle removes both memory and role together because the management page is fused; there is no per-surface profile switch.

<a id="dev-note"></a>
### Dev Note

None.
