# DecryptHub upstream change record

English | [中文](UPSTREAM-CHANGES.zh.md)

This reference owns the reasons for product patches and their retirement conditions. Git owns the complete file history. Product features stay in Cordis plugins and ordinary configuration layers.

## Upstream baseline

- The current source includes upstream master’s rc.5 back-sync merge, PR #8736 (`2e39e70496`, declaring `0.2.2-rc.5`, with the rc.5 tag `9c2670d3bc` as ancestor). Earlier bases were the rc.3 merge PR #8422 and the rc.1 merge PR #7873. The 0.2.3 alpha line and newer master are intentionally not followed in this round.
- The product mainline is `main`, renamed from `feat/dsh-rc1` on 2026-11-21. The branch name does not pin the engine version. The old Tauri history is not merged.
- `packages/core/` and `vendor/` match rc.5 exactly. No product Agent loop, Session format, storage engine or Cordis modification is retained. Recorded Session fixtures follow upstream, except `plugin-manager-mcp`, which keeps the product difference: a server without the resources capability no longer contributes the three resource tools and exposes `mcp_server_status` instead.

## Product ownership and upstream reuse

The native Windows restart banner and status window display the DecryptHub name. The Chat running status rotates product tips while preserving the elapsed clock and screen-reader status. Keep these presentation changes until the upstream installer exposes its product title and Chat exposes its running-status copy.

| Capability | Owner and decision |
|---|---|
| Community account and avatar | Keep `ui-settings-decrypthub-account` and Desktop `community-account-*`; the native bridge is the product-specific carrier. |
| WDH / ADH / IDH | Keep `decrypthub-components`, `decrypthub-integrations`, `ui-mcp` and `mcp-bundle`; reuse upstream MCP clients, tools and UI slots. CLI implementations stay in their own repositories. |
| Memory and role | Keep `product-memory`, `product-persona`, `ui-decrypthub-settings` and `memory-bundle`; use upstream settings and prompt contributions. |
| Session history | Keep `tool-product-sessions` (list + full-text read). Upstream rc.5 adds the supported `tool-session-list`, but it only lists sessions and has no `session_read` body access, and the product tool filters by workspace ownership; retire once upstream covers reading. Tool names do not collide, so both coexist. |
| Skill authoring | Keep removable `tool-skill-manage` for owned create/delete operations. Upstream `skill-filesystem` and `tool-skill` own discovery, watching, catalog and loading; no duplicate scanner is added. |
| Runtime and brand | Keep `product-runtime`, `ui-brand-decrypthub` and `product-identity`. Desktop naming adapts unchanged upstream dictionaries in `decrypthub-locale`; the product bootstrap supplies the title and URL scheme. |

The 13 product packages are private and all appear in `scripts/decrypthub-product.ts`, outside upstream npm publication. The skill/session tool catalogs and required source-map packaging entries are registered.

## Configuration and removed deviations

The upstream Web patch is unchanged. [The product overlay](packages/bundle/web-app/cordis.decrypthub.patch.yml) follows its ordinary preset layers, registered by the Web bundle manifest. This keeps the existing Desktop bundle tuple and user-patch precedence; it does not rewrite a user’s complete composition. The overlay mounts product plugins and disables upstream account/telemetry destinations that this product does not use.

Config editing, provider forms, reasoning menus, settings masks, native text-file opening, Headless/SDK/ACP composition and shared client translations follow upstream. The extra composed-config UI, inactive slider, hidden provider catalog, automatic channel-id variant and forced Notepad behavior are absent. The earlier config file was valid UTF-8; `!!js` is upstream syntax.

The former welcome-notice option is removed; Desktop follows upstream’s existing native-shell check. Product names in generic Web and CLI guidance no longer require editing each upstream dictionary. Reintroduce a deviation only for a demonstrated product requirement that an existing upstream extension cannot carry.

## Remaining inherited runtime patch sites

Each row is an inherited runtime or packaging implementation that still differs from rc.5. Retired in this round: the `CONTENT_REFUSED` refusal patch in `llm-deepseek/translate.ts` and `llm/error.ts` — upstream rc.5 implements equivalent semantics (refusal keeps the provider explanation and settles token usage before raising), so the product patch is dropped wholesale. The MCP Host direct-call channel is kept (see the table): upstream’s new `McpClientHost` mounts/probes/authorizes servers for the management surface but exposes no per-fiber fixed-call channel, so `connectionToolCallerOf` has no equivalent yet. Product-only source files and generated manifests, catalogs, assets and tests remain in the complete Git diff. New runtime patches add their reason and retirement condition here.

| File | Reason and retirement condition |
|---|---|
| [apps/desktop-publisher/src/desktop-auto-update-environment.mjs](apps/desktop-publisher/src/desktop-auto-update-environment.mjs) | Explicit unsigned LAN test feed and product package identity; retire when the upstream publisher accepts equivalent configuration. |
| [apps/desktop/scripts/desktop-build-paths.mjs](apps/desktop/scripts/desktop-build-paths.mjs) | Product packaging, isolated output or artifact names; replace with upstream configuration when available. |
| [apps/desktop/scripts/desktop-build-version-discovery.ts](apps/desktop/scripts/desktop-build-version-discovery.ts) | Product packaging, isolated output or artifact names; replace with upstream configuration when available. |
| [apps/desktop/scripts/desktop-package-environment.mjs](apps/desktop/scripts/desktop-package-environment.mjs) | Explicit unsigned LAN test feed and product package identity; retire when the upstream publisher accepts equivalent configuration. |
| [apps/desktop/scripts/desktop-upload-plan.ts](apps/desktop/scripts/desktop-upload-plan.ts) | Product packaging, isolated output or artifact names; replace with upstream configuration when available. |
| [apps/desktop/scripts/development-app.ts](apps/desktop/scripts/development-app.ts) | Product packaging, isolated output or artifact names; replace with upstream configuration when available. |
| [apps/desktop/scripts/electron-builder-config.mjs](apps/desktop/scripts/electron-builder-config.mjs) | Explicit unsigned LAN test feed, product identity, and an NSIS include wrapper for isolated build resources; retire when upstream supports equivalent configuration and build paths. |
| [apps/desktop/scripts/installed-update-distribution.ts](apps/desktop/scripts/installed-update-distribution.ts) | Product packaging, isolated output or artifact names; replace with upstream configuration when available. |
| [apps/desktop/scripts/package-macos.ts](apps/desktop/scripts/package-macos.ts) | Product packaging, isolated output or artifact names; replace with upstream configuration when available. |
| [apps/desktop/scripts/package-target.ts](apps/desktop/scripts/package-target.ts) | Product packaging, isolated output or artifact names; replace with upstream configuration when available. |
| [apps/desktop/scripts/retain-desktop-ci.ts](apps/desktop/scripts/retain-desktop-ci.ts) | Product packaging, isolated output or artifact names; replace with upstream configuration when available. |
| [apps/desktop/scripts/smoke-packaged-runtime.ts](apps/desktop/scripts/smoke-packaged-runtime.ts) | Product packaging, isolated output or artifact names; replace with upstream configuration when available. |
| [apps/desktop/scripts/verify-retained-desktop.ts](apps/desktop/scripts/verify-retained-desktop.ts) | Product packaging, isolated output or artifact names; replace with upstream configuration when available. |
| [apps/desktop/src/ipc.ts](apps/desktop/src/ipc.ts) | Typed native account bridge registration; retire the patch when product bridges can register externally. |
| [apps/desktop/src/locale.ts](apps/desktop/src/locale.ts) | Import and invoke the product message adapter; dictionaries remain unchanged. Retire when upstream exposes a title contribution. |
| [apps/desktop/src/main.ts](apps/desktop/src/main.ts) | Community account bridge and model-first onboarding; move behind a native extension when upstream provides one. |
| [apps/desktop/src/preload-app.ts](apps/desktop/src/preload-app.ts) | Typed native account bridge registration; retire the patch when product bridges can register externally. |
| [apps/desktop/src/project-manager.ts](apps/desktop/src/project-manager.ts) | Preserve the independent product workspace directory; retire when upstream accepts the product directory as configuration. |
| [apps/desktop/src/welcome-backend.ts](apps/desktop/src/welcome-backend.ts) | Community account bridge and model-first onboarding; move behind a native extension when upstream provides one. |
| [packages/api/remotes/src/client/index.ts](packages/api/remotes/src/client/index.ts) | Component Remote contribution registration; retire when the client assembly supports an external product contribution. |
| [packages/api/workspace-controller/src/default-directory.ts](packages/api/workspace-controller/src/default-directory.ts) | Preserve the independent product workspace directory; retire when upstream accepts the product directory as configuration. |
| [packages/client/ui-plugin-manager/src/client/PluginManagerPage.tsx](packages/client/ui-plugin-manager/src/client/PluginManagerPage.tsx) | Default product feature bundles and their management visibility; retire when upstream exposes an external installation-bundle catalog. |
| [packages/experimental/liveshare/src/endpoint-classification.ts](packages/experimental/liveshare/src/endpoint-classification.ts) | Owner-only component management, device inventory and tool probes; retain authorization until external providers can register classification. |
| [packages/extensions/cordis-client-runner/src/client/slot-catalog.ts](packages/extensions/cordis-client-runner/src/client/slot-catalog.ts) | Generated product API or slot inventory; regenerate from merged source rather than hand-merging generated edits. |
| [packages/extensions/tool-cordis/src/api-catalog.ts](packages/extensions/tool-cordis/src/api-catalog.ts) | Generated product API or slot inventory; regenerate from merged source rather than hand-merging generated edits. |
| [packages/mcp/mcp-client/src/connection.ts](packages/mcp/mcp-client/src/connection.ts), [diagnostic.ts](packages/mcp/mcp-client/src/diagnostic.ts), and [tools.ts](packages/mcp/mcp-client/src/tools.ts) | Publish negotiated resource support, refuse unsupported reads before transport, and report unsent requests on disconnect. Retire when upstream provides equivalent behavior. |
| [packages/mcp/mcp-resources/src/index.ts](packages/mcp/mcp-resources/src/index.ts) | Give the model scoped MCP availability and instructions for reporting results. Retire when upstream uses the live capability and connection facts. |
| [packages/shell/tool-pwsh/src/index.ts](packages/shell/tool-pwsh/src/index.ts), [render.ts](packages/shell/tool-pwsh/src/render.ts), and [persistent pwsh](packages/shell/tool-pwsh-persistent/src/index.ts) | Mark non-zero command exits as command failures in model-facing text. Retire when upstream provides equivalent exit reporting. |
| [packages/util/official-bundles/src/bundles.ts](packages/util/official-bundles/src/bundles.ts) | Default product feature bundles and their management visibility; retire when upstream exposes an external installation-bundle catalog. |
| [packages/util/official-bundles/src/plugin-manager.ts](packages/util/official-bundles/src/plugin-manager.ts) | Default product feature bundles and their management visibility; retire when upstream exposes an external installation-bundle catalog. |

## Build and generator registrations

`apps/cli/package.json`, `packages/bundle/web-app/package.json`, compiler references and aliases register the product packages and overlay. `scripts/product-package-policy.ts`, `scripts/check-workspace-constraints.ts` and `scripts/decrypthub-product.ts` classify package ownership. `gen-cordis-catalog`, `gen-doc-graphs`, `gen-tool-catalog` and README model-experience maps register product services, types and tools. These are explicit registration sites, not changes to execution semantics.

## Sync and verification

The Windows prepared-runtime smoke passed native payload, offline plugin, and Office operation checks. Its temporary profile cleanup stalled on a dangling pnpm junction; removing only that isolated test junction allowed the unchanged upstream cleanup to finish. An NSIS resource-path failure under an isolated build root is addressed by the documented generated include wrapper, without changing installer source. The assembled-runtime smoke uses upstream behavior: the obsolete product requirement for a bundled WDH was removed because components are installed independently. WDH payload-integrity checks remain in their component verification tests.

Fetch upstream and pin the reviewed release merge. Start from product mainline in an isolated worktree; prefer upstream behavior at every patch site and remove newly redundant product code. Regenerate catalogs from the merged source. Run focused product and Desktop checks plus the ordinary build, then inspect a separately packaged client using isolated upgrade data before publishing its test feed. Preserve the user’s running installation and real data.

The Windows recorded-session replay for `deepseek-messages-input-history` reaches persisted output but its comparison currently differs on escaped temporary working-directory paths. Its upstream fixture and normalization code are unchanged. Report this failed signal separately; do not rewrite the expected output or call the complete replay suite green.

The documentation-site build rejects upstream’s `es2024` compiler target in its older esbuild dependency. Website implementation is unchanged; the Desktop Web build accepts the target and passes. This sync does not add a website toolchain override to the product fork. Windows link-guard fixtures use junctions to exercise the same external regular-file checks without file-symlink privileges.

The current local delta is reproducible against the reviewed upstream merge:

```sh
git diff --stat 2e39e70496aa02986ca6a820c5d497e816b69d7e HEAD
git diff --name-status --diff-filter=M 2e39e70496aa02986ca6a820c5d497e816b69d7e HEAD
```
