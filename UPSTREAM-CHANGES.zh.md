# DecryptHub 上游差异记录

[English](UPSTREAM-CHANGES.md) | 中文

本参考记录产品修改的理由与退休条件，完整文件历史以 Git 为准。产品能力保留在 Cordis 插件与正常配置层中。

## 上游基线

- 当前源码包含上游 master 的 rc.3 合并 PR #8422，声明版本为 `0.2.2-rc.3`。原产品基线为 rc.1 的 master 合并 PR #7873。本次同步保留双方历史；较早的 release tag 对应不同代码树。
- 产品主线仍为 `feat/dsh-rc1`，分支名称不限制引擎版本。未合并旧 Tauri `origin/main`。
- `packages/core/`、`vendor/` 与录制会话夹具均与 rc.3 一致。不保留产品侧 Agent 循环、会话格式、存储引擎或 Cordis 修改。

## 产品归属与上游复用

| 能力 | 归属与处理 |
|---|---|
| 社区账号与头像 | 保留 `ui-settings-decrypthub-account` 与 Desktop `community-account-*`，原生桥接负责承载产品身份。 |
| WDH / ADH / IDH | 保留 `decrypthub-components`、`decrypthub-integrations`、`ui-mcp` 和 `mcp-bundle`，复用上游 MCP 客户端、工具与界面插槽。CLI 实现仍在各自仓库。 |
| 记忆与角色 | 保留 `product-memory`、`product-persona`、`ui-decrypthub-settings` 和 `memory-bundle`，使用上游设置与提示词贡献机制。 |
| 会话历史 | 保留 `tool-product-sessions` 作为稳定上游 `ctx.sessionQuery` 的薄适配层。上游面向模型的 `tool-session-query` 仍属 experimental，标准包隔离规则不允许直接依赖。上游受支持工具可替代列表/读取且无需放宽该规则时，再移除适配层；不另建历史库。 |
| 技能编写 | 保留可移除的 `tool-skill-manage`，提供有归属保护的创建/删除。发现、监听、目录与加载由上游 `skill-filesystem`、`tool-skill` 负责，不另建扫描器。 |
| 运行环境与品牌 | 保留 `product-runtime`、`ui-brand-decrypthub`、`product-identity`。Desktop 通过 `decrypthub-locale` 适配未改动的上游词典，由产品启动入口提供名称和 URL 协议。 |

13 个产品包均为 private，并完整登记在 `scripts/decrypthub-product.ts` 中，排除在上游 npm 发布集合外。技能/会话工具目录与必需的源映射打包项已登记。

## 配置与已移除差异

上游 Web patch 保持原样。[产品 overlay](packages/bundle/web-app/cordis.decrypthub.patch.yml) 经 Web bundle 清单登记，按正常顺序加载在预设层之后。这样保留现有 Desktop bundle 列表和用户 patch 优先级，不重写用户的完整组合。该 overlay 挂载产品插件，关闭本产品不使用的上游账号与遥测目标。

配置编辑、提供方表单、思考菜单、设置遮罩、原生文本文件打开、Headless/SDK/ACP 组合及共享客户端翻译沿用上游。没有额外完整配置入口、未启用滑杆、供应商目录隐藏、自动渠道标识分支或强制记事本行为。先前配置文件是合法 UTF-8；`!!js` 是上游语法。

原欢迎公告开关已移除，Desktop 使用上游已有的原生外壳判断。通用 Web 与 CLI 指引中的产品名不再要求逐个改写上游词典。只有经证实的产品需求无法通过现有上游扩展实现时，才重新引入差异。

## 保留的继承运行时代码修改点

下表每行都是仍与 rc.3 不同的继承运行时或打包实现。产品专用源码、生成清单、目录、资源与测试仍在完整 Git diff 中。新增运行时修改须在此补充理由和退休条件。

| 文件 | 理由与退休条件 |
|---|---|
| [apps/desktop-publisher/src/desktop-auto-update-environment.mjs](apps/desktop-publisher/src/desktop-auto-update-environment.mjs) | 显式未签名局域网测试源与产品打包身份；上游发布器支持同等配置后退休。 |
| [apps/desktop/scripts/desktop-build-paths.mjs](apps/desktop/scripts/desktop-build-paths.mjs) | 产品打包、隔离输出或产物名称；上游支持配置后替代源码修改。 |
| [apps/desktop/scripts/desktop-build-version-discovery.ts](apps/desktop/scripts/desktop-build-version-discovery.ts) | 产品打包、隔离输出或产物名称；上游支持配置后替代源码修改。 |
| [apps/desktop/scripts/desktop-package-environment.mjs](apps/desktop/scripts/desktop-package-environment.mjs) | 显式未签名局域网测试源与产品打包身份；上游发布器支持同等配置后退休。 |
| [apps/desktop/scripts/desktop-upload-plan.ts](apps/desktop/scripts/desktop-upload-plan.ts) | 产品打包、隔离输出或产物名称；上游支持配置后替代源码修改。 |
| [apps/desktop/scripts/development-app.ts](apps/desktop/scripts/development-app.ts) | 产品打包、隔离输出或产物名称；上游支持配置后替代源码修改。 |
| [apps/desktop/scripts/electron-builder-config.mjs](apps/desktop/scripts/electron-builder-config.mjs) | 显式未签名局域网测试源、产品打包身份与隔离构建资源的 NSIS include 包装；上游支持同等配置和构建路径后退休。 |
| [apps/desktop/scripts/installed-update-distribution.ts](apps/desktop/scripts/installed-update-distribution.ts) | 产品打包、隔离输出或产物名称；上游支持配置后替代源码修改。 |
| [apps/desktop/scripts/package-macos.ts](apps/desktop/scripts/package-macos.ts) | 产品打包、隔离输出或产物名称；上游支持配置后替代源码修改。 |
| [apps/desktop/scripts/package-target.ts](apps/desktop/scripts/package-target.ts) | 产品打包、隔离输出或产物名称；上游支持配置后替代源码修改。 |
| [apps/desktop/scripts/retain-desktop-ci.ts](apps/desktop/scripts/retain-desktop-ci.ts) | 产品打包、隔离输出或产物名称；上游支持配置后替代源码修改。 |
| [apps/desktop/scripts/smoke-packaged-runtime.ts](apps/desktop/scripts/smoke-packaged-runtime.ts) | 产品打包、隔离输出或产物名称；上游支持配置后替代源码修改。 |
| [apps/desktop/scripts/verify-retained-desktop.ts](apps/desktop/scripts/verify-retained-desktop.ts) | 产品打包、隔离输出或产物名称；上游支持配置后替代源码修改。 |
| [apps/desktop/src/ipc.ts](apps/desktop/src/ipc.ts) | 类型化原生账号桥接登记；产品桥接可外部登记后退休该修改。 |
| [apps/desktop/src/locale.ts](apps/desktop/src/locale.ts) | 导入并调用产品文案适配器，词典保持原样；上游提供名称贡献机制后退休。 |
| [apps/desktop/src/main.ts](apps/desktop/src/main.ts) | 社区账号桥接与模型设置引导；上游提供原生扩展点后迁出。 |
| [apps/desktop/src/preload-app.ts](apps/desktop/src/preload-app.ts) | 类型化原生账号桥接登记；产品桥接可外部登记后退休该修改。 |
| [apps/desktop/src/project-manager.ts](apps/desktop/src/project-manager.ts) | 保持独立产品工作区目录；上游接受产品目录配置后退休。 |
| [apps/desktop/src/welcome-backend.ts](apps/desktop/src/welcome-backend.ts) | 社区账号桥接与模型设置引导；上游提供原生扩展点后迁出。 |
| [packages/api/remotes/src/client/index.ts](packages/api/remotes/src/client/index.ts) | 组件 Remote 贡献登记；客户端组合支持外部产品贡献后迁出。 |
| [packages/api/workspace-controller/src/default-directory.ts](packages/api/workspace-controller/src/default-directory.ts) | 保持独立产品工作区目录；上游接受产品目录配置后退休。 |
| [packages/client/ui-plugin-manager/src/client/PluginManagerPage.tsx](packages/client/ui-plugin-manager/src/client/PluginManagerPage.tsx) | 默认产品功能 bundle 与管理可见性；上游提供外部安装 bundle 目录后迁出。 |
| [packages/experimental/liveshare/src/endpoint-classification.ts](packages/experimental/liveshare/src/endpoint-classification.ts) | 组件管理、设备状态与工具探测仅允许所有者；外部提供方可登记权限分类前保留。 |
| [packages/extensions/cordis-client-runner/src/client/slot-catalog.ts](packages/extensions/cordis-client-runner/src/client/slot-catalog.ts) | 生成的产品 API 或插槽目录；从合并源码重生成，不手工合并生成差异。 |
| [packages/extensions/tool-cordis/src/api-catalog.ts](packages/extensions/tool-cordis/src/api-catalog.ts) | 生成的产品 API 或插槽目录；从合并源码重生成，不手工合并生成差异。 |
| [packages/util/official-bundles/src/bundles.ts](packages/util/official-bundles/src/bundles.ts) | 默认产品功能 bundle 与管理可见性；上游提供外部安装 bundle 目录后迁出。 |
| [packages/util/official-bundles/src/plugin-manager.ts](packages/util/official-bundles/src/plugin-manager.ts) | 默认产品功能 bundle 与管理可见性；上游提供外部安装 bundle 目录后迁出。 |

## 构建与生成器登记

`apps/cli/package.json`、`packages/bundle/web-app/package.json`、编译引用与别名登记产品包和 overlay。`scripts/product-package-policy.ts`、`scripts/check-workspace-constraints.ts`、`scripts/decrypthub-product.ts`声明包归属。`gen-cordis-catalog`、`gen-doc-graphs`、`gen-tool-catalog` 与 README 模型体验映射登记产品服务、类型和工具。这些是显式登记点，不改变执行语义。

## 同步与验证

Windows 预备运行时检查通过原生载荷、离线插件与 Office 操作验证。临时配置清理曾阻塞在失效的 pnpm junction；只移除该隔离测试链接后，未改动的上游清理完成。隔离构建目录下的 NSIS 资源路径失败，由已记录的生成 include 包装修复，不修改安装器源码。成品运行时检查恢复上游行为：组件独立安装，移除产品旧有的 WDH 必须随壳预装前提；WDH 载荷完整性检查保留在组件验证测试中。

fetch 上游并固定审查过的版本合并点。从产品主线建立隔离 worktree；逐个修改点优先采用上游行为，并移除已重复的产品代码。从合并源码重生成目录。运行产品与 Desktop 定向检查和正常构建，再使用隔离升级数据检查单独打包的客户端，之后发布测试源。保留用户正在运行的安装和真实数据。

Windows 上 `deepseek-messages-input-history` 录制回放能够生成持久化输出，但比较时仍出现转义后的临时工作目录与占位符不一致。对应上游夹具与归一化代码保持原样。应单独报告该失败，不改写预期输出，也不宣称完整回放测试通过。

文档站构建所用的旧 esbuild 不接受上游 `es2024` 编译目标。网站实现保持原样；Desktop Web 构建支持该目标并通过。本次同步不为产品分支增加网站工具链覆盖项。Windows 链接防护夹具通过 junction 验证同一个外部普通文件拒绝条件，无需文件符号链接权限。

可通过以下命令复算相对已审查上游合并点的本地差异：

```sh
git diff --stat "upstream/master^{/^Merge pull request #8422 }" HEAD
git diff --name-status --diff-filter=M "upstream/master^{/^Merge pull request #8422 }" HEAD
```
