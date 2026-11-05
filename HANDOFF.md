# Cross-device handoff

Product branch: `decrypthub/dsh-product-20261104` in `https://github.com/decrypthub/DecryptHub.git`. This is the Electron / DSH product; the previous Tauri implementation remains on `handoff/ui-alignment-20261104` in the same remote. See [the detailed Chinese handoff](HANDOFF.zh.md).

```sh
git clone --branch decrypthub/dsh-product-20261104 https://github.com/decrypthub/DecryptHub.git DecryptHub-DSH
cd DecryptHub-DSH
pnpm install --frozen-lockfile
```

Use Node.js >=24.9.0 and the pinned pnpm 11.28.5. Read `PRODUCT-DESIGN.md`, `DECRYPTHUB.md` and `AGENTS.md`. Clone the legacy branch separately as sibling `DecryptHub-Desktop` when its designs are needed; do not merge it into the DSH branch.

The independent WDH runtime is `https://github.com/decrypthub/WebDecryptHub.git`, branch `codex/github-token-for-kernel-download`, commit `b937d45`. Clone it as sibling `WebDecryptHub-Runtime`; build its component and supply `DSH_DESKTOP_WDH_COMPONENT_DIR` before packaging Desktop.

Branding, community login, API formats, reasoning selection, custom MCP and official component management are implemented. Global/system memory UI, dedicated DSH configuration import and the embedded WDH workbench remain pending. Real devices, official release downloads and production account integration still need end-to-end validation.

A development-window HMR failure removed the root slot during rebuild and left a blank page. A frozen packaged preview avoids that delivery problem; the upstream HMR lifecycle itself is not fixed. Keep user previews independent of source rebuilds. `DSH_DESKTOP_BUILD_ROOT` selects an absolute isolated build and packaging root.

Recent focused tests, build/type checks, documentation gates and packaged runtime checks passed. The complete GUI suite retains failures in legacy account/settings/theme expectations and was not fully rerun on the final source. This branch is a development handoff, not a fully qualified release.

Local app data, credentials, device configuration, preview artifacts, browser kernels and installers are excluded. Configure models and devices on the other computer without committing credential files.
