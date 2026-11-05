# DecryptHub Desktop

English | [中文](DECRYPTHUB.zh.md)

This is the DecryptHub product checkout, based on the pinned DeepSeek Harness source snapshot. The upstream repository remains a separate read-only reference. The original MIT license, copyright, and third-party notices remain in place.

## Product composition

DecryptHub is an independent product fork compatible with DSH plugins and configuration. Global memory, system-memory viewing, custom MCP, official WDH / ADH / IDH, and the analysis workbench remain product features; migration gaps do not remove those requirements. Input composition, scrolling, queued messages, the subagent engine, file deliverables, and automation reuse the upstream implementation. [Product design](PRODUCT-DESIGN.md) records the principles and integration status. The dedicated DSH import flow and some of these product pages remain incomplete. Integrated product contributions live in the [brand plugin](packages/client/ui-brand-decrypthub/README.md) and [MCP integration plugin](packages/mcp/decrypthub-integrations/README.md). The Desktop bootstrap selects DecryptHub's application identity before importing the upstream main process.

The preview uses application identifier `cn.decrypthub.desktop.preview`, name `DecryptHub`, and URL scheme `decrypthub`. Its default Electron data directory is `DecryptHub-DSH` under the operating system's application-data directory; the Harness home is its `runtime` child. Explicit user-data and Harness-home overrides remain supported. The old Tauri data directory is neither read nor changed.

Community login uses the [native DecryptHub account plugin](packages/client/ui-settings-decrypthub-account/README.md). The product retains the DSH official DeepSeek API adapter, provider catalog, manual Agent-preset selector, team-mode switch, and developer tools. Community identity does not authorize model inference. First-launch notices, automatic official-key onboarding, official product analytics, session upload, and session telemetry are disabled. First launch opens the workspace; users configure keys in model settings. Custom channels support OpenAI Chat Completions, OpenAI Responses, or Anthropic Messages, with a protocol dropdown and generated internal identities. Reasoning retains English labels and a discrete slider. The unsigned preview has no automatic-update publication configuration.

## Build and run

Use Node.js 24.9 or later and the pinned pnpm toolchain. Install with `pnpm install --frozen-lockfile`, then use the root build commands documented in [AGENTS.md](AGENTS.md). The product plugins stay private and are packed separately for Desktop; they never enter the upstream npm publication family.

Build WDH in the independent `WebDecryptHub-Runtime` checkout with its component builder. Set `DSH_DESKTOP_WDH_COMPONENT_DIR` to the resulting component directory, then run `pnpm --filter @deepseek-ai/dsh-desktop run package:mac:arm64:dir --unsigned`. The assembled application is at `apps/desktop/.desktop-build/targets/mac-arm64/unsigned-artifacts/mac-arm64/DecryptHub.app`. It uses bundled artifacts and the packaged runtime without a source watcher.

The package contains WDH and its license notices, but no browser kernel. The product composition selects CloakBrowser and creates a separate client and profile for each Agent workspace; install a compatible kernel separately before using the browser. ADH and IDH remain optional, independently installed MCP commands; enable them through the product plugin's configuration. No device is attached, rooted, or restarted by this composition.

Custom MCP is managed under Settings → Custom MCP. Official components has its own sidebar and settings entry for WDH / ADH / IDH versions, verified installation, rollback and connection configuration. Device availability is not inferred from an MCP connection. The embedded WDH workbench remains pending.

## Validation and limits

The product checks cover brand-slot lifetime, independent application data, startup without an official account or API key, real stdio workspace isolation and stale-directory refusal, MCP component discovery, packaging resources, and the inherited input and scroll behavior. The Desktop packager also runs the upstream installed-runtime smoke, including native modules, offline plugin installation, and document conversion.

This is a local preview. Old Tauri sessions and model credentials are retained in their existing application and are not imported. WDH browser-frame embedding is not part of the MCP adapter. Formal release signing, notarization, and publication require separate product configuration. The full hygiene check retains the upstream vendor-rescope failures in unchanged files; the product's constraints, metadata, and package-use checks are validated separately.
