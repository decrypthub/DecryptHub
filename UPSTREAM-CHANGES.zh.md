# DecryptHub 上游差异记录

[English](UPSTREAM-CHANGES.md) | 中文

本参考记录产品新增能力、继承的运行时文件内的修改、保留价值与上游同步处理方式。完整文件与提交清单以 Git 为准；本记录不代表已合并上游更新。

## 基线与核查

- 产品基线：DeepSeek Harness `0.2.2-rc.1`，`upstream/master^{/^Merge pull request #7873 }`。
- 2026-11-15 核查的远端：`upstream/master`，`0.2.2-rc.3`，`upstream PR #8422`；比产品基线多 1,371 个提交。本次只 fetch，没有把上游合并进本轮收敛。
- 产品分支：`feat/dsh-rc1`。旧 Tauri `origin/main` 不是本产品的基座。
- `packages/core/` 与 `vendor/` 和固定基线一致。产品功能使用上游 Agent 循环、会话日志、工具执行、设置与插件生命周期。

## 价值与归属

| 能力 | 产品归属 | 判断 |
|---|---|---|
| 社区账号与头像 | `ui-settings-decrypthub-account`；Desktop `community-account-*` | 保留：社区身份和凭据属于产品功能。Electron 桥接仍是继承源码内的修改点。 |
| WDH / ADH / IDH 与自定义 MCP | `decrypthub-components`、`decrypthub-integrations`、`ui-mcp`、`mcp-bundle` | 保留：校验安装、设备状态和分析入口有产品价值。复用上游 MCP、工具和插槽；CLI 保持独立仓库。 |
| 记忆与角色设置 | `product-memory`、`product-persona`、`ui-decrypthub-settings`、`memory-bundle` | 作为插件保留：按工作区隔离记忆，提供统一管理页，不另建会话存储。 |
| 技能与会话工具 | `tool-skill-manage`、`tool-product-sessions` | 有用，但每次同步都要与上游 `skill-filesystem`、`tool-skill`、`sessionQuery` 和可选 `tool-session-query` 对比。重复能力优先退休。当前工具目录生成仍报告这两个产品包缺少 boot-manifest 登记。 |
| 运行环境诊断 | `product-runtime` | 价值主要在诊断；保持为可移除插件，不进入执行引擎。 |
| 品牌、独立数据、打包与更新 | `ui-brand-decrypthub`、`product-identity`、Desktop 构建配置 | 保留产品身份与数据隔离。散落的文案替换会增加合并工作；有现成品牌或配置扩展点时应集中处理。 |

## 已移除的差异

- 移除 `feat: 区分用户配置编辑与完整配置查看` 增加的配置双入口与完整快照实现。`SettingsDocumentAction`、对应 store、`SettingsController`、`SettingsForms`、`ConfigEditor` 恢复为固定上游源码；入口按上游行为打开 profile patch。完整组合仍可通过上游 `dsh --dump-config` 查看。
- 移除未启用的思考强度滑杆、供应商目录隐藏、自动渠道标识分支、自定义设置遮罩与强制记事本打开方式。模型选择和提供方表单复用上游实现，不改写已有提供方标识。
- 原用户覆盖文件是合法 UTF-8，未复现编码损坏。`!!js` 是上游配置表达式。产品代码不替换该格式，也不把用户覆盖项扩展为第二份可编辑配置。

## 继承运行时代码的修改点

下表列出本次收敛后仍与固定基线不同的继承运行时源码、bundle patch 和 Desktop 打包实现。新增产品包、资源、声明、清单、测试、快照与生成文档仍在完整 Git diff 中。“上游也改”仅指与 rc.3 路径重叠，不代表已经确认文本冲突。新增继承源码修改须在此记录理由和退休条件。

| 文件 | 理由与退休条件 | rc.3 上游也改 |
|---|---|---|
| [apps/cli/src/args.ts](apps/cli/src/args.ts) | 产品命名或文案；现有品牌/配置贡献可覆盖此处时退休散落替换。 | 否 |
| [apps/cli/src/plugin.ts](apps/cli/src/plugin.ts) | 产品命名或文案；现有品牌/配置贡献可覆盖此处时退休散落替换。 | 否 |
| [apps/desktop/scripts/desktop-auto-update-environment.mjs](apps/desktop/scripts/desktop-auto-update-environment.mjs) | 产品打包、更新标识与隔离输出；上游支持配置时退休源码替换。 | 否 |
| [apps/desktop/scripts/desktop-build-paths.mjs](apps/desktop/scripts/desktop-build-paths.mjs) | 产品打包、更新标识与隔离输出；上游支持配置时退休源码替换。 | 否 |
| [apps/desktop/scripts/desktop-build-version-discovery.ts](apps/desktop/scripts/desktop-build-version-discovery.ts) | 产品打包、更新标识与隔离输出；上游支持配置时退休源码替换。 | 是 |
| [apps/desktop/scripts/desktop-package-environment.mjs](apps/desktop/scripts/desktop-package-environment.mjs) | 产品打包、更新标识与隔离输出；上游支持配置时退休源码替换。 | 是 |
| [apps/desktop/scripts/desktop-upload-plan.ts](apps/desktop/scripts/desktop-upload-plan.ts) | 产品打包、更新标识与隔离输出；上游支持配置时退休源码替换。 | 是 |
| [apps/desktop/scripts/development-app.ts](apps/desktop/scripts/development-app.ts) | 产品打包、更新标识与隔离输出；上游支持配置时退休源码替换。 | 否 |
| [apps/desktop/scripts/electron-builder-config.mjs](apps/desktop/scripts/electron-builder-config.mjs) | 产品打包、更新标识与隔离输出；上游支持配置时退休源码替换。 | 是 |
| [apps/desktop/scripts/installed-update-distribution.ts](apps/desktop/scripts/installed-update-distribution.ts) | 产品打包、更新标识与隔离输出；上游支持配置时退休源码替换。 | 否 |
| [apps/desktop/scripts/package-macos.ts](apps/desktop/scripts/package-macos.ts) | 产品打包、更新标识与隔离输出；上游支持配置时退休源码替换。 | 是 |
| [apps/desktop/scripts/package-target.ts](apps/desktop/scripts/package-target.ts) | 产品打包、更新标识与隔离输出；上游支持配置时退休源码替换。 | 是 |
| [apps/desktop/scripts/retain-desktop-ci.ts](apps/desktop/scripts/retain-desktop-ci.ts) | 产品打包、更新标识与隔离输出；上游支持配置时退休源码替换。 | 是 |
| [apps/desktop/scripts/smoke-packaged-runtime.ts](apps/desktop/scripts/smoke-packaged-runtime.ts) | 产品打包、更新标识与隔离输出；上游支持配置时退休源码替换。 | 否 |
| [apps/desktop/scripts/verify-retained-desktop.ts](apps/desktop/scripts/verify-retained-desktop.ts) | 产品打包、更新标识与隔离输出；上游支持配置时退休源码替换。 | 是 |
| [apps/desktop/src/command-installation.ts](apps/desktop/src/command-installation.ts) | 产品命名或文案；现有品牌/配置贡献可覆盖此处时退休散落替换。 | 否 |
| [apps/desktop/src/ipc.ts](apps/desktop/src/ipc.ts) | 类型化社区账号 IPC 桥接；原生产品扩展可自行登记桥接后退休此修改。 | 否 |
| [apps/desktop/src/locale.ts](apps/desktop/src/locale.ts) | 产品命名或文案；现有品牌/配置贡献可覆盖此处时退休散落替换。 | 是 |
| [apps/desktop/src/main.ts](apps/desktop/src/main.ts) | 社区账号桥接与引导选择；上游有 Desktop 扩展点后迁出。 | 是 |
| [apps/desktop/src/preload-app.ts](apps/desktop/src/preload-app.ts) | 类型化社区账号 IPC 桥接；原生产品扩展可自行登记桥接后退休此修改。 | 否 |
| [apps/desktop/src/project-manager.ts](apps/desktop/src/project-manager.ts) | 独立产品工作区目录；有可配置产品目录后替代源码替换。 | 否 |
| [apps/desktop/src/welcome-backend.ts](apps/desktop/src/welcome-backend.ts) | 社区账号桥接与引导选择；上游有 Desktop 扩展点后迁出。 | 是 |
| [packages/api/remotes/src/client/index.ts](packages/api/remotes/src/client/index.ts) | 组件 Remote 登记；支持产品独立 Remote 贡献后迁出。 | 是 |
| [packages/api/workspace-controller/src/default-directory.ts](packages/api/workspace-controller/src/default-directory.ts) | 独立产品工作区目录；有可配置产品目录后替代源码替换。 | 否 |
| [packages/bundle/acp-app/cordis.patch.yml](packages/bundle/acp-app/cordis.patch.yml) | 产品插件挂载、账号/遥测策略与默认值；整理组合时迁入产品 bundle。 | 否 |
| [packages/bundle/headless/cordis.patch.yml](packages/bundle/headless/cordis.patch.yml) | 产品插件挂载、账号/遥测策略与默认值；整理组合时迁入产品 bundle。 | 否 |
| [packages/bundle/sdk-app/cordis.patch.yml](packages/bundle/sdk-app/cordis.patch.yml) | 产品插件挂载、账号/遥测策略与默认值；整理组合时迁入产品 bundle。 | 是 |
| [packages/bundle/sdk-app/src/index.ts](packages/bundle/sdk-app/src/index.ts) | 产品命名或文案；现有品牌/配置贡献可覆盖此处时退休散落替换。 | 否 |
| [packages/bundle/web-app/cordis.patch.yml](packages/bundle/web-app/cordis.patch.yml) | 产品插件挂载、账号/遥测策略与默认值；整理组合时迁入产品 bundle。 | 是 |
| [packages/bundle/web-app/src/startup.ts](packages/bundle/web-app/src/startup.ts) | 产品命名或文案；现有品牌/配置贡献可覆盖此处时退休散落替换。 | 否 |
| [packages/client/ui-agent-preset/src/client/guide-locales.ts](packages/client/ui-agent-preset/src/client/guide-locales.ts) | 产品命名或文案；现有品牌/配置贡献可覆盖此处时退休散落替换。 | 是 |
| [packages/client/ui-agent-preset/src/client/locales.ts](packages/client/ui-agent-preset/src/client/locales.ts) | 产品命名或文案；现有品牌/配置贡献可覆盖此处时退休散落替换。 | 是 |
| [packages/client/ui-chat/src/client/conversation-nodes/turn-error.ts](packages/client/ui-chat/src/client/conversation-nodes/turn-error.ts) | 产品命名或文案；现有品牌/配置贡献可覆盖此处时退休散落替换。 | 否 |
| [packages/client/ui-chat/src/client/locale.ts](packages/client/ui-chat/src/client/locale.ts) | 产品命名或文案；现有品牌/配置贡献可覆盖此处时退休散落替换。 | 是 |
| [packages/client/ui-conversation/src/client/locales.ts](packages/client/ui-conversation/src/client/locales.ts) | 产品命名或文案；现有品牌/配置贡献可覆盖此处时退休散落替换。 | 是 |
| [packages/client/ui-entry-customization/src/client/locales.ts](packages/client/ui-entry-customization/src/client/locales.ts) | 产品命名或文案；现有品牌/配置贡献可覆盖此处时退休散落替换。 | 否 |
| [packages/client/ui-plugin-manager/src/client/PluginManagerPage.tsx](packages/client/ui-plugin-manager/src/client/PluginManagerPage.tsx) | 产品 bundle 与管理可见性；上游支持外部 bundle 目录后迁出。 | 是 |
| [packages/client/ui-plugin-manager/src/client/locales.ts](packages/client/ui-plugin-manager/src/client/locales.ts) | 产品命名或文案；现有品牌/配置贡献可覆盖此处时退休散落替换。 | 是 |
| [packages/client/ui-settings-models/src/client/index.ts](packages/client/ui-settings-models/src/client/index.ts) | 一个欢迎公告配置选项；上游提供同等引导设置后退休。 | 否 |
| [packages/client/ui-settings-models/src/index.ts](packages/client/ui-settings-models/src/index.ts) | 一个欢迎公告配置选项；上游提供同等引导设置后退休。 | 否 |
| [packages/client/ui-settings-models/src/onboarding-config.ts](packages/client/ui-settings-models/src/onboarding-config.ts) | 一个欢迎公告配置选项；上游提供同等引导设置后退休。 | 否 |
| [packages/client/ui-sidebar-browser/src/client/locales.ts](packages/client/ui-sidebar-browser/src/client/locales.ts) | 产品命名或文案；现有品牌/配置贡献可覆盖此处时退休散落替换。 | 否 |
| [packages/client/ui-sidebar-documentpreview/src/client/office/locales.ts](packages/client/ui-sidebar-documentpreview/src/client/office/locales.ts) | 产品命名或文案；现有品牌/配置贡献可覆盖此处时退休散落替换。 | 否 |
| [packages/experimental/liveshare/src/endpoint-classification.ts](packages/experimental/liveshare/src/endpoint-classification.ts) | 组件端点仅供所有者调用；外部端点可自行登记权限前保留。 | 是 |
| [packages/extensions/cordis-client-runner/src/client/slot-catalog.ts](packages/extensions/cordis-client-runner/src/client/slot-catalog.ts) | 生成的产品 API/插槽目录；从合并后的源码重生成，不手工保留生成差异。 | 是 |
| [packages/extensions/tool-cordis/src/api-catalog.ts](packages/extensions/tool-cordis/src/api-catalog.ts) | 生成的产品 API/插槽目录；从合并后的源码重生成，不手工保留生成差异。 | 是 |
| [packages/util/official-bundles/src/bundles.ts](packages/util/official-bundles/src/bundles.ts) | 产品 bundle 与管理可见性；上游支持外部 bundle 目录后迁出。 | 是 |
| [packages/util/official-bundles/src/plugin-manager.ts](packages/util/official-bundles/src/plugin-manager.ts) | 产品 bundle 与管理可见性；上游支持外部 bundle 目录后迁出。 | 是 |

## 同步上游

1. fetch `upstream/master`，记录精确提交并与产品基线比较。从当前产品分支建立独立同步分支/worktree，保留用户工作与已安装客户端。
2. 逐项审查保留修改点，优先采用上游行为；上游已覆盖时移除产品修改。通过配置或插件保留产品账号、独立数据与组件能力。
3. 从合并源码重生成目录与类型元数据。按 [dsh-pre-push-checks](.agents/skills/dsh-pre-push-checks/SKILL.md) 选择检查，并运行产品组合定向测试、隔离安装包核查与更新源验证。单独报告已有失败。
4. 只有上游合并及验证通过后才更新产品基线记录。把验过的安装包发布测试源；源码重建不得替换用户正在验收的客户端。

以下命令可复算当前完整差异；第一条包含新增插件，第二条只选择继承文件。

```sh
git diff --stat "upstream/master^{/^Merge pull request #7873 }" HEAD
git diff --name-status --diff-filter=M "upstream/master^{/^Merge pull request #7873 }" HEAD
```
