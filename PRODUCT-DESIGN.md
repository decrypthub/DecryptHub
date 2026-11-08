# DecryptHub product design

English | [中文](PRODUCT-DESIGN.zh.md)

DecryptHub is an independent product fork of DeepSeek Harness. Importing compatible DSH plugins and configuration is a product requirement, alongside global memory, custom MCP, official MCP, and the analysis workbench. DSH owns sessions and execution; DecryptHub owns features, navigation, and interaction. The existing design sources are [UI system](../DecryptHub-Desktop/docs/ui-system.md), [work tabs](../DecryptHub-Desktop/docs/workspace-tabs.md), [component architecture](../DecryptHub-Desktop/docs/component-architecture.md), [plugin management](../DecryptHub-Desktop/docs/plugins.md), and [reasoning selection](../DecryptHub-Desktop/docs/thinking-slider-20261104.md). The old Tauri source and user data remain in their original directories.

## Product and compatibility principles

The product reuses DSH's mature execution, session, and interaction mechanisms. DecryptHub features connect to those same services through product modules or plugins. Existing designs must remain requirements when upstream lacks a corresponding page, migration is incomplete, or adaptation needs additional work. Record migration gaps explicitly and verify migrated features against their established responsibilities.

Upstream mechanisms come first. A product change mounts a plugin row, registers on a documented extension point, or supplies configuration; it does not copy or edit an upstream package when an extension point already carries the behavior. Where a product requirement genuinely needs code inside an upstream file, keep the addition to a registration call, record the reason in `scripts/product-package-policy.ts`, and treat the file as a sync conflict site. Product packages reach the model and the user through the same mechanisms as upstream ones, so `pnpm run verify-product-use` applies to them unchanged.

DSH plugin and configuration import must identify the source and compatible version, list importable items, mapped settings, and incompatible items, and resolve naming conflicts with existing DecryptHub configuration. Imports create DecryptHub-owned configuration without modifying the source DSH installation or data directory, silently discarding settings, or replacing DecryptHub's product composition wholesale. Ordinary plugin installation and cross-product import require separate acceptance.

The model page retains the DSH provider catalog and offers three API formats for custom channels; imported DSH plugins retain their compatible configuration capabilities. Built-in product features, DecryptHub official MCP, and third-party DSH plugins are managed separately. Users should not have to find plugins manually to recover the memory and management pages the product is expected to provide. Upstream synchronization preserves these product decisions.

## Product choices

| Area | Product decision | Current integration |
|---|---|---|
| Appearance | Tomato accent, system fonts, compact workbench; darker red primary buttons with white text | Public theme overrides in both palettes; the home headline is “Start a task” |
| Projects and sessions | Projects at left, conversation at center, session-owned work tabs at right | DSH workspaces, sessions, and right tabs; retain files, documents, terminals, and deliverables |
| Input and execution | IME composition, messages during execution, queue, cancellation, scrolling, approval, subagent navigation | Reuse the corresponding DSH components and Host services |
| DSH plugin and configuration import | Preserve plugin identity, version, and compatible configuration; show mappings, incompatible items, and naming conflicts | No DecryptHub-specific import flow exists yet; existing DSH plugin management services can be reused |
| Global memory and skills | Global content across projects, isolated project and session content; viewing, scope-aware management, and deletion | Existing implementation is in `ui/src/memory-panel.jsx`; the new product management page and Agent read/write integration still await migration |
| System memory | Read-only product content and connected-plugin environment instructions, with readable bodies and sources | Existing `sidecar/system-memory.mjs` provides sources and bodies; the new product viewer still awaits migration |
| API channels | Retain the DSH official DeepSeek API adapter and provider catalog; custom channels offer three API formats, generated internal identities, and a full-width endpoint field | Existing provider catalog, custom-channel forms, validation, credentials, and revision checks |
| Reasoning | Current English level, model entry, discrete slider; no fast or reset button | Model declarations and Radix Slider; retain DSH model search and Host persistence |
| Agent mode | Retain manual preset selection, the model-menu team switch, and Agent delegation | DSH preset entry enabled; team extensions remain below the reasoning slider, with team and subagent activity retained |
| Custom MCP | Server configuration, configuration import, enablement, reconnection, tools, and actual connection state | Implemented in `ui-mcp`: revision-checked forms, reviewed JSON imports, enablement, reconnect, tool inspection and live state |
| Official MCP and components | Official WDH / ADH / IDH catalog, installation, versions, and connection management; separate from custom MCP with distinct installation, connection, and target state | Sidebar and settings management implemented in `ui-mcp` and `decrypthub-components`: verified versions, cancellable installs, rollback and separate connection state; actual release downloads and device behavior still require validation |
| WDH workbench | One shared connection per session, linked webpage, network, debugger, and Profile; CloakBrowser on Desktop | Product composition selects Cloak; page rendering, capture, and debugging subviews still await migration; the ordinary DSH browser tab is not their replacement |
| File changes | Per-turn deliverables and changed files; defer a separate Git changes page | Retain DSH deliverable cards and diff viewing without adding Git navigation |
| Accounts and upstream services | DecryptHub community login; retain developer tools; omit first-launch notices, automatic official-key onboarding, official telemetry, and session upload | Native account plugin supplies login, cancellation, logout, profile, points, and experience; models independently use DSH API adapters; production login awaits community endpoint acceptance |

## Acceptance requirements

Interactions reuse existing services and maintained controls. The product layer owns no second Agent, session log, or scroll state machine. Reasoning levels come only from the selected model. Drag previews do not write to the Host; failed submissions restore the controlled selection and older completions cannot clear newer previews. API channels retain credential handling and settings revision checks.

Component pages report installation, connection, and target facts only after reading their actual sources. Installing a CLI does not establish a device connection; connecting MCP does not select a target. Pending capabilities are not represented by static “Ready” cards or inactive action buttons.

Memory acceptance covers global availability across projects, project and session isolation, explicitly scoped reading and deletion, restart recovery, and read-only system-memory bodies. DSH import acceptance covers preservation of compatible plugins and configuration, naming conflicts, incompatible-item feedback, and unchanged source directories. Successful low-level MCP calls do not constitute acceptance of these product features.

UI acceptance covers actual windows, long content, narrow layouts, both palettes, keyboard input, IME, reload recovery, and messages during execution. A successful build and component tests do not constitute native-window acceptance. Source builds do not overwrite the fixed application or data the user is testing; only separately packaged and checked artifacts are run as a new version.
