---
description: "Native DecryptHub community sign-in and account settings."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-decrypthub-account

English | [中文](README.zh.md)

## Summary

This product plugin supplies the community account section and sidebar launcher through DSH settings slots. Electron owns browser authorization and encrypted persistence; the client receives only display identity, points, experience, and classified failures. Community login does not authorize model inference. API keys and provider selection remain with DSH model settings.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The DecryptHub Web bundle mounts this plugin. Its client presentation activates only when the native community-account bridge is available; ordinary browser clients keep their existing settings launcher. Settings → Account offers browser sign-in, cancellation, profile refresh, sign-out, and community links. The launcher provides settings and account actions. Points and experience remain separate, with unknown counters displayed as `—`.

<a id="understand-the-implementation"></a>
## Understand the implementation

The native implementation in [`apps/desktop/src/community-account.ts`](../../../apps/desktop/src/community-account.ts) binds an ephemeral loopback callback to PKCE S256 and a random state. It rejects duplicate or invalid callback parameters without consuming the attempt. Cancellation, timeout, disposal, or an account change prevents late results from committing. Login is published only after encrypted persistence succeeds. Failed persistence or a cancelled exchange revokes any received but uncommitted grant on a best-effort basis.

Electron safeStorage encrypts the application-owned credential file. Unavailable encryption and Linux plaintext backends fail visibly. Main-process commands validate the current application's top-level frame. No account grant enters the renderer, Host, model tools, API-key store, or project files. The packaged issuer is `https://decrypthub.cn`; unpackaged builds may explicitly select a validated development issuer. Requests reject redirects, have deadlines, and bound response size.

Restart restores a locally valid grant. Refresh retains cached identity during temporary network failure; a rejected grant is removed. Local sign-out completes only after credential deletion succeeds, then attempts remote revocation without restoring the local grant on network failure. Monotonic native revisions keep late IPC reads from replacing newer state. Client plugin disposal detaches its native subscription and settings contributions.

<a id="model-experience"></a>
## Model Experience

None, as native community account presentation adds no model input.

#### KV Cache effect

None. Account presentation does not enter model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Production browser authorization requires the community desktop endpoints to be deployed. Local protocol tests do not establish production availability. Old Tauri credentials are not imported. The account image uses a local initial rather than fetching a remote avatar. Model credits, payments, and account-based inference are not provided by the community desktop-session protocol. The native flow still requires acceptance on Windows and Linux.

<a id="dev-note"></a>
### Dev Note

None.
