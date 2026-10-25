# DecryptHub 与平台组件：拆分提案

日期：2026-10-25。状态：原始架构提案。桌面改名、独立 WDH 和本地组件安装器已落地；当前实现以 [拆分边界](component-architecture.md) 和 [组件安装](components.md) 为准，远程目录/自动更新仍待实现。

## 产品边界

DecryptHub 是通用桌面 Agent Harness；WebDecryptHub、IOSDecryptHub、AndroidDecryptHub 是可独立维护的平台能力。组件不依赖 DecryptHub 的模型、会话存储和 UI 才能工作，可通过 MCP/CLI 被其他宿主使用。

| 产品 | 负责 | 首次安装要求 |
|---|---|---|
| DecryptHub | 模型、会话、工作区、权限、Executor、目标/子代理、MCP Host、组件管理和通用界面 | 可独立进行代码与文件任务，不加载平台组件 |
| WebDecryptHub / WDH | Web 分析运行时、MCP/CLI、浏览器控制、抓包、调试、指纹访问追踪、分析产物 | 按需安装运行时；浏览器内核单独选择/下载，不要求配置移动设备 |
| IOSDecryptHub / IDH | iOS 设备端分析能力，复用 idh-cli 连接/MCP 网关 | 用户自行完成设备插件安装/注入，再配置连接 |
| AndroidDecryptHub / ADH | Android 设备端分析能力，复用 adh-cli 和 Host Daemon | 用户自行完成设备端插件配置，再配置 Host/设备连接 |

WDH 是分析运行时，浏览器内核是它的依赖。WDH 版本、内核版本、桌面宿主版本分别维护。现有 idh-cli、adh-cli 仓库可继续独立发布，不必为了“四个产品”强行合并成四个仓库。

已核对的接入基础：[idh-cli](https://github.com/decrypthub/idh-cli) 将设备 Streamable HTTP MCP 桥接为 stdio；[adh-cli](https://github.com/decrypthub/adh-cli) 将 Host Daemon 的 HTTP MCP 桥接为 stdio。设备就绪与 CLI 安装成功是不同状态，不能合并成一个“已安装”。

## 用户流程

1. 首次安装仅得到通用 Harness，平台组件不启动、不占上下文、不附带大型浏览器与逆向依赖。
2. 用户提出 Web/iOS/Android 分析任务；Agent 查询组件状态及能力，选择相应组件。
3. 缺少组件时通过宿主组件管理器安装官方目录中已验证的版本。标准权限确认首次安装信任；完全访问权限可按已授权的官方目录策略执行，避免每个下载动作重复审批。网页/模型提供的任意 URL 不能变成受信组件。
4. WDH 准备浏览器后可直接分析。IDH/ADH 检查 CLI、Daemon、设备、目标 App 和协议能力；缺少设备插件时显示具体准备步骤，不由 Agent 自动刷机或注入安装。
5. 分析输出落入当前任务的产物空间；会话、Run、目标和组件版本可关联排查。模块故障不终止无关的 Harness 文件任务。

建议将组件、连接、分析任务分别建模。例如组件可为未安装/安装中/已安装/运行中/不兼容/失败；设备连接另有离线/在线/待配对状态；分析任务单独保存目标身份、运行状态和版本绑定。

## 协议边界

**控制通道使用 MCP。** CLI 提供同一能力的脚本入口，不实现第二套自然语言决策。已有工具 schema、目标 ID、分页和副作用确认语义继续保留。参考 [MCP transports](https://modelcontextprotocol.io/specification/latest/basic/transports)。

**显示和大量数据不塞进模型工具结果。** WDH 另提供版本化的界面会话协议，描述画面/事件流、页面状态、抓包索引、暂停状态和产物引用；大量数据分页或文件化读取。允许使用 MCP resources/通知表达索引与进度，但高频画面帧不逐帧转为模型消息。

**原生窗口由宿主管理。** BrowserSurface 和 Rust 的 Win32/X11 adapter 属于 DecryptHub；WDH 运行时管理浏览器与目标。宿主通过可信组件进程租约验证浏览器归属，不能因某个 MCP 工具返回任意 PID，就把该进程窗口接进来。第三方网页和模块 UI 不获得 Tauri IPC 与模型密钥。

**会话身份需要显式绑定。** Harness session/run、MCP transport session、Web analysis session、设备 target_id 是不同标识。组件适配器绑定当前分析目标；模型不能填一个其他会话的 ID 就访问其浏览器/设备。共享 MCP 服务需要目标隔离，不能继续依赖全局“当前页面”。

IDH 的聚合工具包含二次路由：外层 idh_call_tool 不能被简单认作只读。宿主需要核对内层工具 schema/副作用及当前 target_id，按统一策略授权，再由可信适配器传递授权字段。MCP 注解是提示，不能单独作为提升权限的依据。

## 组件管理器

宿主统一提供目录查询、安装、版本列表、启停、诊断、升级、回滚及卸载；Agent 调用这些确定性接口，不自己拼接 curl/pip/npm 安装命令。

组件清单至少包括：

| 字段 | 用途 |
|---|---|
| id / version / source | 稳定组件身份、精确版本、官方仓库/发布来源 |
| manifestVersion / hostApi / analysisApi | 清单格式与宿主业务协议兼容范围，不能只看 MCP 握手是否成功 |
| platforms / assets | OS、CPU、下载地址、大小、SHA-256 与签名 |
| dependencies | Node/Python/内核/CLI/设备协议要求，不污染用户全局环境 |
| entrypoints / transports | 固定 MCP/CLI 入口与参数，不接受清单外的启动脚本 |
| capabilities / permissions | 真实可用能力与所需资源；受信目录的风险声明和实际工具版本绑定 |
| health / licenses / upstream | 就绪检查、第三方声明和来源版本 |

安装流程：验证目录/签名 → 下载至独立 staging → 摘要与大小校验 → 安全解压 → 仅准备托管运行时完整性 → 启动/能力检查 → 原子激活。失败保留旧版本，不自动退回另一种内核或宿主权限。

沿用本项目已有的路径、链接和 Windows 完整性防线，只处理可信组件的代码目录，不修改整个用户工作区。API Key、设备连接凭据和 Profile 由宿主私有存储管理，不写入发布清单或普通日志。

当前 IDH/ADH README 明确说明其服务无身份认证、适合可信网络。这是接入时必须准确呈现的当前边界；MCP 不是自动带认证的网络隧道。后续联网部署需另做配对、认证和连接范围设计，不将设备服务自动暴露到公网。

## WDH 的独立维护范围

现有 BrowserManager、browsertools、抓包存储、内核管理、McpBridge/vendor 调试器及领域分析工具逐步移入 WDH。当前 host 通过同一 WDH 接口使用它们，外部 MCP 客户端/CLI 也走相同的领域实现。测试同时验证独立运行与宿主集成，避免出现两套不同的工具行为。

首个版本优先实现稳定的页面/目标身份、控制、抓包、断点、源码与产物协议。旧 VMP/环境模拟工具不能因为改包名就宣称解决复杂 JSVMP；专用能力需要独立样本、成功标准和资源预算。

指纹/隐私分析建议记录以下证据链：

`API 访问 → 返回值/脱敏摘要 → 脚本来源与 hash/调用栈 → 变换证据 → 网络发送及接收域名`

“读过 API”“读取了标识值”“发送了对应值”分开报告；hash 后的外发关联需要验证，不能仅根据时间相近作确定结论。记录 frame/worker/target、时间与关联 ID，并声明覆盖范围。document-start、iframe、Worker、ServiceWorker、WASM 分别验收；插桩具备事件/存储预算、采样、性能测量和卸载能力，默认浏览不进行重度插桩。

原始采集数据本地保存，MCP 默认按需返回摘要/分页和产物引用。需要模型分析原始敏感值时遵循用户授权，不能把“本地采集”误说成“绝不会发给模型服务”。

## 独立发布与更新

各仓库可通过 GitHub Releases 分别发布产物。组件目录将精确版本、平台 asset 和摘要/签名绑定；安装和分析 Run 锁定版本，不运行时执行 latest 或更新正在使用的浏览器/设备客户端。

维护的是宿主 API、组件 API、设备协议/CLI 和数据格式的兼容范围，版本号不要求同步。升级前自检，失败可回滚；数据迁移与回滚兼容性必须单独验证，不能只回滚二进制。模块升级不应强制升级整个桌面。

### 旧 WDH 桌面更新地址

当前桌面订阅 `decrypthub/WebDecryptHub/releases/latest/download/latest.json`。新 WDH 组件发布不能抢占这个地址并让旧桌面误读组件更新。

迁移期保持旧桌面更新入口可用，先发布可迁往新桌面更新源的过渡版本。新组件由独立目录指定 tag，必要时将组件 Release 标记 make_latest=false，保留旧桌面的 Latest；GitHub 支持该字段，见 [Releases API](https://docs.github.com/en/rest/releases/releases#create-a-release)。只改 Git remote 或依赖仓库重定向不足以完成客户端迁移。

## 许可与来源

js-reverse-mcp 当前为 Apache-2.0。分发时附带许可，保留适用的版权/归属和上游 NOTICE（如提供），显著标明被修改的文件。保留源文件原有版权头，包括已有 Google LLC 头；WDH 自有代码和项目许可另行决定，不能将上游代码重新标为“全部原创 MIT”。记录来源仓库、基准 commit 和补丁，确保可以复现、对比和跟进修复。参考 [上游 LICENSE](https://github.com/zhizhuodemao/js-reverse-mcp/blob/main/LICENSE) 和 [Apache-2.0 §4](https://www.apache.org/licenses/LICENSE-2.0)。

CloakBrowser 包装代码采用 MIT，但其编译内核采用独立二进制许可，当前有重分发、嵌入/OEM 及订阅限制。列出依赖并让用户从官方渠道下载有单独条款，不能把它扩大解释为所有嵌入/再分发场景都被授权。WDH 的默认分发方案应基于许可允许的构建或用户已有浏览器；Cloak 保留为按所选版本条款接入的可选内核，需要时取得明确授权。不得擅自修改其受限二进制；自有 trace/指纹观测改动放在 WDH 的分析与插桩层。参考 [CloakBrowser Binary License](https://github.com/CloakHQ/CloakBrowser/blob/main/BINARY-LICENSE.md)。

## 建议迁移顺序与验收

1. 固定接口与兼容规则。在现有工作树内隔离 Core 与 Web 的依赖/工具注册，先让宿主通过模块接口使用本地 WDH，保留现有行为。
2. 桌面品牌改为 DecryptHub，设计并验证旧数据、会话 ID、Profile、密钥库和更新源迁移。展示名不等于存储根或 Tauri identifier；不能全局替换字符串。
3. WDH 完成独立 MCP/CLI 入口及完整契约回归后再拆仓。新 DecryptHub 承载宿主，WebDecryptHub 保留 Web 能力和既有历史/来源。
4. 加入签名目录和组件管理器，验证“干净宿主 → 安装 WDH → 打开/抓包/断点/光效 → 关闭/重启 → 升级/回滚”。核心安装包不包含 WDH 大依赖。
5. 接入现有 IDH/ADH 网关，验证设备未配置、掉线、目标重启/身份变化、协议不兼容与取消。设备刷入由用户完成，不作为自动安装成功的一部分。

成功标准：组件可以由其他 MCP 客户端和 CLI 独立使用；宿主缺少/卸载组件后仍可正常工作；所有平台产物以同一会话/Run/目标/版本证据链汇总；持续运行任务不被后台升级替换；浏览器原生界面及授权行为通过所声明平台的真实回归。
