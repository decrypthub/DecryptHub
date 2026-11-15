# DecryptHub upstream change record

English | [中文](UPSTREAM-CHANGES.zh.md)

This reference records product additions, changes inside inherited runtime files, their value, and their upstream-sync treatment. Git remains the complete file and commit inventory; this record does not imply that upstream changes have been merged.

## Baseline and inspection

- Product base: DeepSeek Harness `0.2.2-rc.1`, `upstream/master^{/^Merge pull request #7873 }`.
- Remote inspected on 2026-11-15: `upstream/master`, `0.2.2-rc.3`, `upstream PR #8422`; 1,371 commits after the product base. Fetch only; no upstream merge is included in this cleanup.
- Product branch: `feat/dsh-rc1`. The old Tauri `origin/main` is not this product’s base.
- `packages/core/` and `vendor/` match the pinned base. Product features use the upstream Agent loop, Session log, tool pipeline, settings, and plugin lifecycle.

## Value and ownership

| Capability | Product owner | Assessment |
|---|---|---|
| Community account and avatar | `ui-settings-decrypthub-account`; Desktop `community-account-*` | Keep: community identity and credentials are product-specific. The Electron bridge remains an inherited-source patch site. |
| WDH / ADH / IDH and custom MCP | `decrypthub-components`, `decrypthub-integrations`, `ui-mcp`, `mcp-bundle` | Keep: verified installation, device inventory and analysis access add product value. Reuse upstream MCP, tools and slots; keep CLIs in their independent repositories. |
| Memory and role settings | `product-memory`, `product-persona`, `ui-decrypthub-settings`, `memory-bundle` | Keep as plugins: workspace-scoped memory and a shared management page; no parallel Session store. |
| Skill and session tools | `tool-skill-manage`, `tool-product-sessions` | Useful, but compare against upstream `skill-filesystem`, `tool-skill`, `sessionQuery` and optional `tool-session-query` on each sync. Prefer retiring a duplicate over maintaining it. Catalog generation currently reports missing boot-manifest entries for these two product packages. |
| Runtime diagnostics | `product-runtime` | Optional diagnostic value; retain as a removable plugin rather than adding it to the execution engine. |
| Branding, independent data, packaging and updates | `ui-brand-decrypthub`, `product-identity`, Desktop build configuration | Keep product identity and data separation. Scattered copy substitutions add merge work; consolidate through existing brand/configuration seams when available. |

## Removed deviations

- The two config actions and composed snapshot implementation introduced in `feat: 区分用户配置编辑与完整配置查看` are removed. `SettingsDocumentAction`, its store, `SettingsController`, `SettingsForms` and `ConfigEditor` match the pinned upstream source again; the action opens the profile patch, as upstream does. Full composition remains available through upstream `dsh --dump-config`.
- The inactive reasoning slider, provider-catalog suppression, automatic channel-id variant, custom settings mask and forced Notepad opener are removed. Model selection and provider forms reuse their upstream implementations. Existing saved provider identities are not rewritten.
- The original override file was valid UTF-8; no encoding damage was reproduced. `!!js` is an upstream configuration expression. Product code does not replace that format or expand user overrides into a second editable configuration.

## Inherited runtime patch sites

The following table lists inherited runtime source, bundle patches and Desktop packaging implementations that still differ from the pinned base after this cleanup. New product packages, assets, declarations, manifests, tests, snapshots and generated documentation remain visible in the complete Git diff. “Also changed” means path overlap with rc.3, not a confirmed textual merge conflict. New inherited-source changes must add a reason and a retirement condition here.

| File | Reason and retirement condition | Also changed in rc.3 |
|---|---|---|
| [apps/cli/src/args.ts](apps/cli/src/args.ts) | Product naming/copy; retire scattered substitutions when an existing brand/configuration contribution covers this surface. | No |
| [apps/cli/src/plugin.ts](apps/cli/src/plugin.ts) | Product naming/copy; retire scattered substitutions when an existing brand/configuration contribution covers this surface. | No |
| [apps/desktop/scripts/desktop-auto-update-environment.mjs](apps/desktop/scripts/desktop-auto-update-environment.mjs) | Product packaging, update identity and isolated output; retire substitutions when upstream accepts these as configuration. | No |
| [apps/desktop/scripts/desktop-build-paths.mjs](apps/desktop/scripts/desktop-build-paths.mjs) | Product packaging, update identity and isolated output; retire substitutions when upstream accepts these as configuration. | No |
| [apps/desktop/scripts/desktop-build-version-discovery.ts](apps/desktop/scripts/desktop-build-version-discovery.ts) | Product packaging, update identity and isolated output; retire substitutions when upstream accepts these as configuration. | Yes |
| [apps/desktop/scripts/desktop-package-environment.mjs](apps/desktop/scripts/desktop-package-environment.mjs) | Product packaging, update identity and isolated output; retire substitutions when upstream accepts these as configuration. | Yes |
| [apps/desktop/scripts/desktop-upload-plan.ts](apps/desktop/scripts/desktop-upload-plan.ts) | Product packaging, update identity and isolated output; retire substitutions when upstream accepts these as configuration. | Yes |
| [apps/desktop/scripts/development-app.ts](apps/desktop/scripts/development-app.ts) | Product packaging, update identity and isolated output; retire substitutions when upstream accepts these as configuration. | No |
| [apps/desktop/scripts/electron-builder-config.mjs](apps/desktop/scripts/electron-builder-config.mjs) | Product packaging, update identity and isolated output; retire substitutions when upstream accepts these as configuration. | Yes |
| [apps/desktop/scripts/installed-update-distribution.ts](apps/desktop/scripts/installed-update-distribution.ts) | Product packaging, update identity and isolated output; retire substitutions when upstream accepts these as configuration. | No |
| [apps/desktop/scripts/package-macos.ts](apps/desktop/scripts/package-macos.ts) | Product packaging, update identity and isolated output; retire substitutions when upstream accepts these as configuration. | Yes |
| [apps/desktop/scripts/package-target.ts](apps/desktop/scripts/package-target.ts) | Product packaging, update identity and isolated output; retire substitutions when upstream accepts these as configuration. | Yes |
| [apps/desktop/scripts/retain-desktop-ci.ts](apps/desktop/scripts/retain-desktop-ci.ts) | Product packaging, update identity and isolated output; retire substitutions when upstream accepts these as configuration. | Yes |
| [apps/desktop/scripts/smoke-packaged-runtime.ts](apps/desktop/scripts/smoke-packaged-runtime.ts) | Product packaging, update identity and isolated output; retire substitutions when upstream accepts these as configuration. | No |
| [apps/desktop/scripts/verify-retained-desktop.ts](apps/desktop/scripts/verify-retained-desktop.ts) | Product packaging, update identity and isolated output; retire substitutions when upstream accepts these as configuration. | Yes |
| [apps/desktop/src/command-installation.ts](apps/desktop/src/command-installation.ts) | Product naming/copy; retire scattered substitutions when an existing brand/configuration contribution covers this surface. | No |
| [apps/desktop/src/ipc.ts](apps/desktop/src/ipc.ts) | Typed community-account IPC bridge; retire the patch when native product extensions can register their own bridge. | No |
| [apps/desktop/src/locale.ts](apps/desktop/src/locale.ts) | Product naming/copy; retire scattered substitutions when an existing brand/configuration contribution covers this surface. | Yes |
| [apps/desktop/src/main.ts](apps/desktop/src/main.ts) | Community account bridge and onboarding selection; move behind a Desktop extension point when upstream provides one. | Yes |
| [apps/desktop/src/preload-app.ts](apps/desktop/src/preload-app.ts) | Typed community-account IPC bridge; retire the patch when native product extensions can register their own bridge. | No |
| [apps/desktop/src/project-manager.ts](apps/desktop/src/project-manager.ts) | Independent product workspace directory; prefer a configurable product directory over a source substitution. | No |
| [apps/desktop/src/welcome-backend.ts](apps/desktop/src/welcome-backend.ts) | Community account bridge and onboarding selection; move behind a Desktop extension point when upstream provides one. | Yes |
| [packages/api/remotes/src/client/index.ts](packages/api/remotes/src/client/index.ts) | Component Remote registration; use a product-owned Remote contribution when supported. | Yes |
| [packages/api/workspace-controller/src/default-directory.ts](packages/api/workspace-controller/src/default-directory.ts) | Independent product workspace directory; prefer a configurable product directory over a source substitution. | No |
| [packages/bundle/acp-app/cordis.patch.yml](packages/bundle/acp-app/cordis.patch.yml) | Product plugin mounts, account/telemetry policy and defaults; move product rows to a product bundle during composition cleanup. | No |
| [packages/bundle/headless/cordis.patch.yml](packages/bundle/headless/cordis.patch.yml) | Product plugin mounts, account/telemetry policy and defaults; move product rows to a product bundle during composition cleanup. | No |
| [packages/bundle/sdk-app/cordis.patch.yml](packages/bundle/sdk-app/cordis.patch.yml) | Product plugin mounts, account/telemetry policy and defaults; move product rows to a product bundle during composition cleanup. | Yes |
| [packages/bundle/sdk-app/src/index.ts](packages/bundle/sdk-app/src/index.ts) | Product naming/copy; retire scattered substitutions when an existing brand/configuration contribution covers this surface. | No |
| [packages/bundle/web-app/cordis.patch.yml](packages/bundle/web-app/cordis.patch.yml) | Product plugin mounts, account/telemetry policy and defaults; move product rows to a product bundle during composition cleanup. | Yes |
| [packages/bundle/web-app/src/startup.ts](packages/bundle/web-app/src/startup.ts) | Product naming/copy; retire scattered substitutions when an existing brand/configuration contribution covers this surface. | No |
| [packages/client/ui-agent-preset/src/client/guide-locales.ts](packages/client/ui-agent-preset/src/client/guide-locales.ts) | Product naming/copy; retire scattered substitutions when an existing brand/configuration contribution covers this surface. | Yes |
| [packages/client/ui-agent-preset/src/client/locales.ts](packages/client/ui-agent-preset/src/client/locales.ts) | Product naming/copy; retire scattered substitutions when an existing brand/configuration contribution covers this surface. | Yes |
| [packages/client/ui-chat/src/client/conversation-nodes/turn-error.ts](packages/client/ui-chat/src/client/conversation-nodes/turn-error.ts) | Product naming/copy; retire scattered substitutions when an existing brand/configuration contribution covers this surface. | No |
| [packages/client/ui-chat/src/client/locale.ts](packages/client/ui-chat/src/client/locale.ts) | Product naming/copy; retire scattered substitutions when an existing brand/configuration contribution covers this surface. | Yes |
| [packages/client/ui-conversation/src/client/locales.ts](packages/client/ui-conversation/src/client/locales.ts) | Product naming/copy; retire scattered substitutions when an existing brand/configuration contribution covers this surface. | Yes |
| [packages/client/ui-entry-customization/src/client/locales.ts](packages/client/ui-entry-customization/src/client/locales.ts) | Product naming/copy; retire scattered substitutions when an existing brand/configuration contribution covers this surface. | No |
| [packages/client/ui-plugin-manager/src/client/PluginManagerPage.tsx](packages/client/ui-plugin-manager/src/client/PluginManagerPage.tsx) | Product bundles and their management visibility; move to an external bundle catalog when upstream supports one. | Yes |
| [packages/client/ui-plugin-manager/src/client/locales.ts](packages/client/ui-plugin-manager/src/client/locales.ts) | Product naming/copy; retire scattered substitutions when an existing brand/configuration contribution covers this surface. | Yes |
| [packages/client/ui-settings-models/src/client/index.ts](packages/client/ui-settings-models/src/client/index.ts) | One welcome-notice configuration option; retire when upstream provides the equivalent onboarding setting. | No |
| [packages/client/ui-settings-models/src/index.ts](packages/client/ui-settings-models/src/index.ts) | One welcome-notice configuration option; retire when upstream provides the equivalent onboarding setting. | No |
| [packages/client/ui-settings-models/src/onboarding-config.ts](packages/client/ui-settings-models/src/onboarding-config.ts) | One welcome-notice configuration option; retire when upstream provides the equivalent onboarding setting. | No |
| [packages/client/ui-sidebar-browser/src/client/locales.ts](packages/client/ui-sidebar-browser/src/client/locales.ts) | Product naming/copy; retire scattered substitutions when an existing brand/configuration contribution covers this surface. | No |
| [packages/client/ui-sidebar-documentpreview/src/client/office/locales.ts](packages/client/ui-sidebar-documentpreview/src/client/office/locales.ts) | Product naming/copy; retire scattered substitutions when an existing brand/configuration contribution covers this surface. | No |
| [packages/experimental/liveshare/src/endpoint-classification.ts](packages/experimental/liveshare/src/endpoint-classification.ts) | Owner-only component endpoints; preserve authorization until upstream supports external endpoint classification. | Yes |
| [packages/extensions/cordis-client-runner/src/client/slot-catalog.ts](packages/extensions/cordis-client-runner/src/client/slot-catalog.ts) | Generated product API/slot inventory; regenerate from the merged source instead of preserving generated edits by hand. | Yes |
| [packages/extensions/tool-cordis/src/api-catalog.ts](packages/extensions/tool-cordis/src/api-catalog.ts) | Generated product API/slot inventory; regenerate from the merged source instead of preserving generated edits by hand. | Yes |
| [packages/util/official-bundles/src/bundles.ts](packages/util/official-bundles/src/bundles.ts) | Product bundles and their management visibility; move to an external bundle catalog when upstream supports one. | Yes |
| [packages/util/official-bundles/src/plugin-manager.ts](packages/util/official-bundles/src/plugin-manager.ts) | Product bundles and their management visibility; move to an external bundle catalog when upstream supports one. | Yes |

## Synchronizing upstream

1. Fetch `upstream/master`, record its exact commit and compare it with the product base. Use a separate sync branch/worktree from the current product branch; preserve user work and the installed client.
2. Inspect every retained patch site. Take upstream behavior first; remove a product patch if upstream now covers it. Preserve product accounts, independent data and component capabilities through configuration or plugins.
3. Regenerate catalogs and type metadata from merged source. Run the checks selected by [dsh-pre-push-checks](.agents/skills/dsh-pre-push-checks/SKILL.md), focused product composition tests, an isolated packaged-client check and update-feed verification. Report existing failures separately.
4. Update the recorded product base only after the upstream merge and its validation pass. Publish the checked package to the test feed; source rebuilding must not replace the client the user is accepting.

The complete current delta is reproducible with these commands; the first diff includes plugin additions, while the second selects inherited files only.

```sh
git diff --stat "upstream/master^{/^Merge pull request #7873 }" HEAD
git diff --name-status --diff-filter=M "upstream/master^{/^Merge pull request #7873 }" HEAD
```
