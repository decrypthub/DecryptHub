# Cross-device handoff

English | [中文](HANDOFF.zh.md)

The DecryptHub desktop product is developed on `main` in [DecryptHub](https://github.com/decrypthub/DecryptHub). This branch follows the DeepSeek Harness product history; do not merge the old Tauri implementation into it. See [the upstream change record](UPSTREAM-CHANGES.md) for the pinned engine base and retained product patches.

## Set up another checkout

Use Node.js >=24.9.0 and the pnpm version pinned in `package.json`.

```sh
git clone --branch main https://github.com/decrypthub/DecryptHub.git DecryptHub-DSH
cd DecryptHub-DSH
pnpm install --frozen-lockfile
```

Read [the product design](PRODUCT-DESIGN.md), [the product setup](DECRYPTHUB.md), and [the repository instructions](AGENTS.md). WebDecryptHub is a separate [browser component](https://github.com/decrypthub/WebDecryptHub). Use the component build selected for the desktop version under test, and point `DSH_DESKTOP_WDH_COMPONENT_DIR` at its component directory. The component and Desktop use separate Git histories.

## Validate and share a preview

Use [the testing guide](docs/testing.md) for the checks relevant to your change. Build a fixed preview rather than leaving the user on a window that reloads when sources change. An absolute `DSH_DESKTOP_BUILD_ROOT` isolates packaging outputs. A preview is not a qualified production release.

Configure local models and devices on the destination computer. Do not commit or copy account credentials, local application data, device configuration, browser kernels, or installers as part of the source checkout.
