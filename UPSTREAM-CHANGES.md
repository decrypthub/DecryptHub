# DecryptHub upstream change record

English | [中文](UPSTREAM-CHANGES.zh.md)

This reference owns the reasons for product patches and their retirement conditions. Git owns the complete file history. Product features stay in Cordis plugins and ordinary configuration layers.

## Upstream baseline

- The current source includes upstream master’s rc.3 merge, PR #8422, declaring `0.2.2-rc.3`. The previous product base was the rc.1 master merge, PR #7873. The sync preserves both histories; the earlier release tags identify different trees.
- Product mainline remains `feat/dsh-rc1`; its name does not pin the engine version. The old Tauri `origin/main` is not merged.
- `packages/core/`, `vendor/` and the recorded Session fixtures match rc.3. No product Agent loop, Session format, storage engine or Cordis modification is retained.

## Product ownership and upstream reuse

| Capability | Owner and decision |
|---|---|
| Community account and avatar | Keep `ui-settings-decrypthub-account` and Desktop `community-account-*`; the native bridge is the product-specific carrier. |
| WDH / ADH / IDH | Keep `decrypthub-components`, `decrypthub-integrations`, `ui-mcp` and `mcp-bundle`; reuse upstream MCP clients, tools and UI slots. CLI implementations stay in their own repositories. |
| Memory and role | Keep `product-memory`, `product-persona`, `ui-decrypthub-settings` and `memory-bundle`; use upstream settings and prompt contributions. |
| Session history | Keep `tool-product-sessions` as a thin adapter over stable upstream `ctx.sessionQuery`. The upstream model-facing `tool-session-query` remains experimental: standard-package isolation forbids a direct dependency. Retire this adapter once a supported upstream tool can replace list/read without relaxing that rule. No second history store is added. |
| Skill authoring | Keep removable `tool-skill-manage` for owned create/delete operations. Upstream `skill-filesystem` and `tool-skill` own discovery, watching, catalog and loading; no duplicate scanner is added. |
| Runtime and brand | Keep `product-runtime`, `ui-brand-decrypthub` and `product-identity`. Desktop naming adapts unchanged upstream dictionaries in `decrypthub-locale`; the product bootstrap supplies the title and URL scheme. |

The 13 product packages are private and all appear in `scripts/decrypthub-product.ts`, outside upstream npm publication. The skill/session tool catalogs and required source-map packaging entries are registered.

## Configuration and removed deviations

The upstream Web patch is unchanged. [The product overlay](packages/bundle/web-app/cordis.decrypthub.patch.yml) follows its ordinary preset layers, registered by the Web bundle manifest. This keeps the existing Desktop bundle tuple and user-patch precedence; it does not rewrite a user’s complete composition. The overlay mounts product plugins and disables upstream account/telemetry destinations that this product does not use.

Config editing, provider forms, reasoning menus, settings masks, native text-file opening, Headless/SDK/ACP composition and shared client translations follow upstream. The extra composed-config UI, inactive slider, hidden provider catalog, automatic channel-id variant and forced Notepad behavior are absent. The earlier config file was valid UTF-8; `!!js` is upstream syntax.

The former welcome-notice option is removed; Desktop follows upstream’s existing native-shell check. Product names in generic Web and CLI guidance no longer require editing each upstream dictionary. Reintroduce a deviation only for a demonstrated product requirement that an existing upstream extension cannot carry.

## Remaining inherited runtime patch sites

Each row is an inherited runtime or packaging implementation that still differs from rc.3. Product-only source files and generated manifests, catalogs, assets and tests remain in the complete Git diff. New runtime patches add their reason and retirement condition here.

| File | Reason and retirement condition |
|---|---|
| [apps/desktop-publisher/src/desktop-auto-update-environment.mjs](apps/desktop-publisher/src/desktop-auto-update-environment.mjs) | Explicit unsigned LAN test feed and product package identity; retire when the upstream publisher accepts equivalent configuration. |
| [apps/desktop/scripts/desktop-build-paths.mjs](apps/desktop/scripts/desktop-build-paths.mjs) | Product packaging, isolated output or artifact names; replace with upstream configuration when available. |
| [apps/desktop/scripts/desktop-build-version-discovery.ts](apps/desktop/scripts/desktop-build-version-discovery.ts) | Product packaging, isolated output or artifact names; replace with upstream configuration when available. |
| [apps/desktop/scripts/desktop-package-environment.mjs](apps/desktop/scripts/desktop-package-environment.mjs) | Explicit unsigned LAN test feed and product package identity; retire when the upstream publisher accepts equivalent configuration. |
| [apps/desktop/scripts/desktop-upload-plan.ts](apps/desktop/scripts/desktop-upload-plan.ts) | Product packaging, isolated output or artifact names; replace with upstream configuration when available. |
| [apps/desktop/scripts/development-app.ts](apps/desktop/scripts/development-app.ts) | Product packaging, isolated output or artifact names; replace with upstream configuration when available. |
| [apps/desktop/scripts/electron-builder-config.mjs](apps/desktop/scripts/electron-builder-config.mjs) | Explicit unsigned LAN test feed and product package identity; retire when the upstream publisher accepts equivalent configuration. |
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
| [packages/util/official-bundles/src/bundles.ts](packages/util/official-bundles/src/bundles.ts) | Default product feature bundles and their management visibility; retire when upstream exposes an external installation-bundle catalog. |
| [packages/util/official-bundles/src/plugin-manager.ts](packages/util/official-bundles/src/plugin-manager.ts) | Default product feature bundles and their management visibility; retire when upstream exposes an external installation-bundle catalog. |

## Build and generator registrations

`apps/cli/package.json`, `packages/bundle/web-app/package.json`, compiler references and aliases register the product packages and overlay. `scripts/product-package-policy.ts`, `scripts/check-workspace-constraints.ts` and `scripts/decrypthub-product.ts` classify package ownership. `gen-cordis-catalog`, `gen-doc-graphs`, `gen-tool-catalog` and README model-experience maps register product services, types and tools. These are explicit registration sites, not changes to execution semantics.

## Sync and verification

Fetch upstream and pin the reviewed release merge. Start from product mainline in an isolated worktree; prefer upstream behavior at every patch site and remove newly redundant product code. Regenerate catalogs from the merged source. Run focused product and Desktop checks plus the ordinary build, then inspect a separately packaged client using isolated upgrade data before publishing its test feed. Preserve the user’s running installation and real data.

The Windows recorded-session replay for `deepseek-messages-input-history` reaches persisted output but its comparison currently differs on escaped temporary working-directory paths. Its upstream fixture and normalization code are unchanged. Report this failed signal separately; do not rewrite the expected output or call the complete replay suite green.

The documentation-site build rejects upstream’s `es2024` compiler target in its older esbuild dependency. Website implementation is unchanged; the Desktop Web build accepts the target and passes. This sync does not add a website toolchain override to the product fork. Windows link-guard fixtures use junctions to exercise the same external regular-file checks without file-symlink privileges.

The current local delta is reproducible against the reviewed upstream merge:

```sh
git diff --stat "upstream/master^{/^Merge pull request #8422 }" HEAD
git diff --name-status --diff-filter=M "upstream/master^{/^Merge pull request #8422 }" HEAD
```
