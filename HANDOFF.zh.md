# 跨设备交接

[English](HANDOFF.md) | 中文

DecryptHub 桌面端在 [DecryptHub](https://github.com/decrypthub/DecryptHub) 的 `main` 分支开发。该分支沿用 DeepSeek Harness 产品线的历史，不要将旧 Tauri 实现合入。固定的引擎基线和保留的产品改动见[上游差异记录](UPSTREAM-CHANGES.zh.md)。

## 在另一台电脑检出

使用 Node.js >=24.9.0 和 `package.json` 固定的 pnpm 版本。

```sh
git clone --branch main https://github.com/decrypthub/DecryptHub.git DecryptHub-DSH
cd DecryptHub-DSH
pnpm install --frozen-lockfile
```

阅读[产品设计](PRODUCT-DESIGN.zh.md)、[产品配置](DECRYPTHUB.zh.md)和[仓库说明](AGENTS.md)。WebDecryptHub 是独立的[浏览器组件](https://github.com/decrypthub/WebDecryptHub)。使用与待测桌面版本配套的组件构建，将 `DSH_DESKTOP_WDH_COMPONENT_DIR` 指向其组件目录。组件和桌面端分别维护 Git 历史。

## 验证与交付预览

按[测试指南](docs/testing.zh.md)执行与改动相关的检查。给用户提供固定构建的预览，不要让用户在会随源码变更而重载的窗口中验收。用绝对路径 `DSH_DESKTOP_BUILD_ROOT` 隔离打包产物。预览不等于已通过正式发布验证。

换机后在目标电脑配置本机模型和设备。不要把账号凭据、应用数据、设备配置、浏览器内核或安装包作为源码检出的一部分提交或复制。
