# 插件管理

状态：2026-10-25。左侧「插件」取代原 Agent 工作台入口，聊天保持主界面。所有官方组件和自定义 MCP 在同一页面管理。

## 官方插件

| 插件 | 下载来源 | 安装内容与运行要求 |
|---|---|---|
| WDH | decrypthub/WebDecryptHub | 独立浏览器 MCP；预览包支持 Windows/Linux x64，复用宿主 Node；桌面版内核固定为 WDH 自带的 CloakBrowser，不再提供系统 Chrome / 自定义路径 / GitHub Release 选项 |
| IDH | decrypthub/idh-cli | iOS 的电脑端 MCP 网关；Python 3.10+，设备插件自行部署 |
| ADH | decrypthub/adh-cli | Android 的电脑端 MCP 网关；Python 3.10+，设备插件与 Host ADH Daemon 自行部署 |

「下载并安装」会显示实际进度，允许取消。页面分别显示安装版本、官方可用版本、启用状态、连接状态、工具数量和 MCP 服务报告的版本；网关版本与设备端版本不混为一谈。缺少兼容制品、离线、GitHub 限流或缺少运行依赖时明确显示原因。

安装 IDH / ADH 后展开「配置」，填写 HTTP 设备服务地址并保存连接。安装只涉及电脑端网关。托管 IDH 禁用自身的 pip 自更新，更新由插件管理器统一管理。Python 使用实际解释器绝对路径和隔离启动参数，不依赖 launcher 在被重定向的用户目录里猜测环境。

WDH 默认按需启动，不会仅因打开插件页就打开网站。关闭 WDH 会释放所属浏览器并从 Agent 工具表移除浏览器工具。变更插件时需停止正在运行的 Agent；下载和校验期间保留旧激活版本。

## 自定义 MCP

同页支持 stdio、Streamable HTTP 和 SSE、手动配置与 mcpServers JSON 导入。导入默认停用，保存启用才批准该启动配置。连接成功显示服务真实报告的版本；重连及工具列表保持原功能。官方 IDH / ADH 使用保留名称 decrypthub_idh / decrypthub_adh，在官方详情配置，避免导入 JSON 意外覆盖。

MCP 配置由专用接口持有，保存模型或浏览器偏好不会以旧快照覆盖新配置。

## 下载信任与激活

- 下载源固定为上表的官方仓库。只识别平台、架构及 ID 相符的 ZIP；旧 WDH 桌面安装包不会被当作浏览器组件。
- 检查 GitHub API 给出的资产 SHA-256、大小、发布 ID；下载前按发布 ID 复核。重定向只允许 GitHub 官方 HTTPS 资产域名。
- 安全解压拒绝路径越界和链接，并限制条目/解压大小。异步校验并准备全部文件后才切换激活指针，支持取消，失败保留旧版本。
- 验证组件 ID、版本、运行时、来源仓库、源提交及每个文件 SHA-256。下载不执行任意 shell 安装脚本。

这里信任官方 GitHub 仓库、TLS 与 GitHub API 提供的 digest；不将此声明为独立发布者签名。签名目录和密钥轮换可在同一契约上继续增加。已下载缓存与旧版本保留用于恢复，不自动递归删除用户目录或运行中的版本。

## 维护与验收

WDH：npm run build 后运行 node scripts/package-component.mjs，得到 wdh-<version>-<platform>-<arch>.zip。两个网关各自仓库包含 python scripts/build_component.py、组件验证和 CI；得到 idh/adh-<version>-any.zip。分别通过各自 GitHub Releases 维护，桌面只约束 API 1，不复制 CLI 业务代码。

预览包 tag 使用 wdh-v<version>-preview.N 或 decrypthub-v<version>-preview.N，界面标明预览版，不替代旧桌面稳定更新源。

本地检查：核心测试、build:ui、audit:ui、check:ui；check:plugins 使用新应用数据，验证从官方 Release 实际下载三个插件、校验、MCP 配置和连接、自定义 MCP、版本显示、停用与浅深色截图。设备联调使用本地 HTTP 样本，不触碰用户已连接设备。

高级环境可用 DECRYPTHUB_PYTHON 指定 Python 绝对路径。CI 可以设置 DECRYPTHUB_GITHUB_TOKEN 读取官方仓库元数据；该凭据不会传给浏览器、Python 或其他 MCP 子进程。

## 真机连接验收

源码、CLI、电脑端服务和手机端是独立环节。Android 的 ADB 在线不代表 Host ADH Daemon 已启动，网关 MCP 连接成功也不代表目标 App 在线。IDH 需目标 App 正在运行且可访问设备 HTTP 服务；ADH 需 Host Daemon 在线、ADB reverse 正确及实际设备 Agent 已接入。

`npm run check:mobile` 是显式启用的真机检查，不在常规 CI 中运行。通过 `DECRYPTHUB_TEST_IDH_ENDPOINT`、`DECRYPTHUB_TEST_ADH_ENDPOINT` 指定本次端点，至少提供一个；两者都使用真实安装的 CLI，再经桌面 RPC、官方托管网关、`discover_tools(mcp)` 和 Agent 工具路由验证。Android 多目标时必须以 `DECRYPTHUB_TEST_ADH_PACKAGE` 选择一个实际在线包名，不能猜测目标。

默认创建独立的 `.tmp/mobile-plugins-*` 配置。显式提供 `DECRYPTHUB_TEST_DATA_DIR` 则将选中的官方网关连接保存到该应用数据目录，便于随后启动桌面体验；其余模型/MCP 设置由正常接口保留。该目录不能同时被另一个桌面实例使用。再次运行会复用匹配的已启用连接，验证保存后的重启恢复。

验证只调用 IDH 的能力/统计及 ADH 的进程列表、能力和连通性探针，不安装设备插件、不重启目标、不布 Hook、不启用 Trace。结果只保存版本、检查项与通过状态，不导出事件内容、密钥或请求数据。创建的验收会话结束前恢复标准权限并关闭；手机、源码目录和既有 Host Daemon 由用户配置，脚本不自动探测或修改。

自定义本机 CLI 的 stdio MCP 可显式传 `mcp --endpoint <地址>`（IDH 全局参数 `--no-auto-update` 放在 `mcp` 前）。需要沿用已有 CLI 连接文件时，在服务环境变量中指定 `IDH_CONFIG_PATH` / `ADH_CONFIG_PATH` 的绝对路径；不要依赖过滤环境后的进程自动继承用户 HOME。官方托管连接使用私有配置和显式端点，避免串用其他项目或设备的配置。
