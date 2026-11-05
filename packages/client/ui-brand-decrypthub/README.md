---
description: "DecryptHub identity for the sidebar and conversation hero."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-brand-decrypthub

English | [中文](README.zh.md)

## Summary

This product plugin supplies DecryptHub's artwork and name through the sidebar and conversation hero brand slots, and its tomato-red palette through the public theme API. Primary controls use a darker red fill with white foreground in both palettes. The Host entry is inert; client registrations and theme overrides are disposed with their owning plugin scope.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The DecryptHub Web bundle mounts this package and disables the upstream official brand package. The product name remains DecryptHub in every interface language. This package makes no image requests: the existing product artwork is embedded in the client bundle.

<a id="understand-the-implementation"></a>
## Understand the implementation

The client registers the sidebar mark and name together after both slots are declared. The conversation hero mark has its own declaration lifetime. Disposing a declaration or the plugin removes its occupants. The mark preserves the requested size and host class.

<a id="model-experience"></a>
## Model Experience

None, as brand presentation adds no model input.

#### KV Cache effect

None. Brand presentation does not enter provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Window names, application icons, and build-time browser titles belong to their application owners and are not changed by these slots.

<a id="dev-note"></a>
### Dev Note

None.
