# DecryptHub Desktop

[English](DECRYPTHUB.md) | 中文

此仓库是 DecryptHub 产品主干，基于 固定的 DeepSeek Harness 源码快照。上游仓库作为独立的只读参考保留。原始 MIT 许可证、版权和第三方声明均保留。

## 产品组成

DecryptHub 是兼容 DSH 插件与配置的独立产品分支。全局记忆、系统记忆查看、自定义 MCP、官方 WDH / ADH / IDH 和分析工作台保留为自有产品功能，迁移缺口不能视为功能删除。输入法组合、滚动、待发送消息、子代理引擎、文件产物和自动化复用上游实现；具体原则与接入状态见[产品设计](PRODUCT-DESIGN.zh.md)。目前专用 DSH 导入流程及上述部分产品页面尚未完成。已接入的产品扩展放在[品牌插件](packages/client/ui-brand-decrypthub/README.zh.md)与 [MCP 集成插件](packages/mcp/decrypthub-integrations/README.zh.md)中。Desktop 启动入口先设置 DecryptHub 应用身份，再导入上游主进程。

预览版使用应用标识 `cn.decrypthub.desktop.preview`、名称 `DecryptHub` 和 URL 协议 `decrypthub`。Electron 默认数据目录位于操作系统应用数据目录下的 `DecryptHub-DSH`，Harness 数据位于其中的 `runtime` 子目录。仍支持显式指定用户数据和 Harness 数据目录。不读取或修改旧 Tauri 数据目录。

社区登录使用[原生 DecryptHub 账号插件](packages/client/ui-settings-decrypthub-account/README.zh.md)。产品保留 DSH 官方 DeepSeek API 适配器、供应商目录、手动 Agent 预设、团队模式开关和开发者工具，社区身份不授权模型推理。首启公告、官方密钥自动引导、官方产品分析、会话上传和会话遥测关闭。首次启动进入工作区，用户在模型设置中配置密钥。自定义渠道支持 OpenAI Chat Completions、OpenAI Responses 或 Anthropic Messages，接口格式使用下拉框，内部标识自动生成。思考强度保持英文档位和离散滑杆。未签发预览包不带自动更新发布配置。

## 构建与运行

使用 Node.js 24.9 或更新版本和项目固定的 pnpm 工具链。执行 `pnpm install --frozen-lockfile` 后，按照 [AGENTS.md](AGENTS.md) 使用根目录构建命令。产品插件保持私有，单独打包进入 Desktop，不进入上游 npm 发布集合。

在独立的 `WebDecryptHub-Runtime` 仓库使用其组件构建器构建 WDH。将 `DSH_DESKTOP_WDH_COMPONENT_DIR` 指向组件产物目录，再执行 `pnpm --filter @deepseek-ai/dsh-desktop run package:mac:arm64:dir --unsigned`。应用产物位于 `apps/desktop/.desktop-build/targets/mac-arm64/unsigned-artifacts/mac-arm64/DecryptHub.app`，运行打包产物和内置运行时，不监听源码。

安装包包含 WDH 及其许可证声明，不包含浏览器内核。产品组合选择 CloakBrowser，为每个 Agent 工作区创建独立客户端和用户目录；使用浏览器前需单独安装兼容内核。ADH、IDH 是可选的独立 MCP 命令，需要单独安装，并通过产品插件配置启用。此组合不会附加、提权或重启设备。

自定义 MCP 在「设置 → 自定义 MCP」中管理。「官方组件」提供独立侧栏与设置入口，管理 WDH / ADH / IDH 版本、校验安装、回滚和连接配置。MCP 连接成功不代表设备可用，内嵌 WDH 工作台仍待迁移。

## 验证与限制

产品检查覆盖品牌插槽生命周期、独立应用数据、无官方账户或 API 密钥时的启动、真实 stdio 工作目录隔离和旧目录调用拒绝、MCP 组件发现、打包资源，以及沿用的输入与滚动行为。Desktop 打包器还执行上游安装后运行时检查，覆盖原生模块、离线插件安装和文档转换。

当前为本地预览版。旧 Tauri 会话和模型凭据保留在原应用中，尚未导入。MCP 适配器不包含 WDH 浏览器画面嵌入。正式发布的签名、公证和上线需要独立产品配置。完整 hygiene 检查仍有上游未改文件中的 vendor-rescope 错误；产品自身的约束、元数据和包使用检查单独验证。
