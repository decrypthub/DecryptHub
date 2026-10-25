# 通用桌面 Agent：工作区、权限与 Harness 设计草案

日期：2026-10-24。状态：初版 Harness 已实施，当前实现见 [browser-harness.md](./browser-harness.md)、[executor.md](./executor.md) 与 [security.md](./security.md)。下文保留最初审计和长期设计，不代表所有建议均已交付。

实际交付：单一工作根与原生目录凭证、三档权限、统一执行器与显式宿主降级、运行日志及恢复、版本化文件改动、系统凭据库密文同步、通用浏览器工具、MCP 配置信任、自动化待处理状态。未交付：Git worktree、云执行、完整 OS 文件句柄防竞态、Windows 沙箱安装后的验收和捕获数据保留期管理。

托管会话目录会持久保留，不使用可被系统随时清理的临时目录。应用私有 dataDir 不作为第二个模型工作区。

本文依据当前工作树，而非只依据 README 或旧版本。仓库已有大量未提交改动；本次只新增本文，不修改运行时代码。未找到与 WebDecryptHub 路径匹配的 Claude Code 专属 MEMORY.md；名称相近的 DecryptHubWeb 记忆索引指向另一套网站项目，不作为本项目的实现依据。

## 1. 核心决定

产品应围绕「用户交给 Agent 的任务」组织。文件夹是可选的工作资源，浏览器是可选的能力。

建议保留 Tauri + React + sidecar、现有 provider 适配器和事件化 History，逐步补上 Workspace、统一 ToolRouter、权限 Broker、受限 Executor 和可恢复 Run。现阶段不整体替换 Agent 引擎。

有五条基础约束：

1. 用户不选文件夹，也能完整工作；需要落盘时使用应用管理的会话工作区。
2. 用户选择文件夹后，文件工具与命令以该目录为工作根；聊天记录、密钥、浏览器 Profile 不写进用户项目。
3. 工作目录、资源授权、审批规则、操作系统隔离分别建模。设置 cwd 不产生隔离。
4. 所有实际副作用都经过宿主控制，包含工具内部的自测、依赖安装、MCP 启动和子进程。
5. 模型、网页、仓库说明、Skill 和外部工具返回值都不能给自己授予权限。

以下权限默认值是本产品的设计建议，不是对参考产品默认行为的复刻。

## 2. 当前工程能复用什么、缺什么

| 当前实现 | 证据 | 对转型的影响 |
| --- | --- | --- |
| Agent 已可在没有浏览器时发送任务 | `sidecar/sessions.mjs` 的 `send()`、`ensureAgent()` | 通用对话入口已存在 |
| provider、工具 schema、History、循环已有分层 | `sidecar/providers/`、`contract.mjs`、`history.mjs`、`agent.mjs` | 保留接缝，逐步演进 |
| `projectDir` 是应用数据下的会话目录 | `sidecar/sessions.mjs:23` | 它不是用户选择的代码仓库 |
| `workspace_*` 再固定访问 `projectDir/workspace` | `sidecar/workspace.mjs:34` | 不能直接把用户文件夹塞给 projectDir，否则目录语义与存储都会错位 |
| Shell 以工作区为 cwd，但由宿主直接 spawn | `sidecar/workspace.mjs:290` | 命令仍拥有当前用户可用的文件与网络权限 |
| `resolveIn()` 做字符串归一化和目录前缀检查 | `sidecar/paths.mjs:19` | 能挡普通 `..`，没有处理 symlink、Windows junction/reparse point 与检查后替换 |
| 审批按 shell/npm/overwrite/reset 类别放行 | `sidecar/policy.mjs:90`、`sessions.mjs:68` | 一次允许 shell 会覆盖多种代码执行，授权范围太粗 |
| 未知工具没有匹配审批类别就直接运行 | `sidecar/agent.mjs:164`、`policy.mjs` | 外接 MCP 工具不因未知而进入审批 |
| `export_code` 归 WRITE，内部实际执行 Python/JS | `sidecar/policy.mjs:31`、`localtools.mjs:177` | 「导出」包含执行副作用，标准模式也可绕过执行审批 |
| 环境过滤只覆盖部分工作区进程 | `workspace.mjs` 的 `childEnv()`；`localtools.mjs:130,202`；`mcphost.mjs:153` | runner 和 MCP 仍有直接继承宿主环境的路径 |
| 每步向模型提供全部已连接工具 | `sidecar/agent.mjs:156` | 通用任务也承受逆向工具的上下文成本和干扰 |
| 自动化固定启动浏览器，并在 send 接受后记录成功 | `sidecar/tasks.mjs:71` | 非网页任务多余启动浏览器；投递成功被误作任务完成 |
| History 的事件语义是追加式，常规任务在结束时 persist | `sidecar/history.mjs`、`agent.mjs:270,362` | 尚不能据此声称每个副作用已有崩溃恢复能力 |

另有两个需要保留的现有防线：WebSocket 接入票据与 Origin 检查，以及 Markdown 清理与 CSP。它们解决接入和渲染问题，不能替代 Agent 的资源权限。

本次对 `decideTool()` 做了无副作用核对：标准模式下 `export_code` 返回 run；未登记的 `example__unregistered_write` 风险为 exec，但也返回 run。

## 3. 从参考项目借鉴哪些边界

| 参考 | 官方材料确认的机制 | 本项目采用的思路 |
| --- | --- | --- |
| Codex | 操作系统 Sandbox 与 Approval Policy 分开；App Server 以 Thread / Turn / Item 暴露执行与审批 | 分离资源边界与交互审批，UI 消费结构化执行事件。[权限文档](https://learn.chatgpt.com/docs/agent-approvals-security)、[App Server](https://learn.chatgpt.com/docs/app-server) |
| Claude Code | 工作目录授权与配置发现有区别；内置 shell sandbox 并不自动包住文件工具、MCP 和 hooks | 目录访问授权不等于允许项目配置启动程序；各执行入口单独纳入边界。[目录与权限](https://code.claude.com/docs/en/permissions)、[Sandbox 范围](https://code.claude.com/docs/en/sandboxing) |
| OpenCode | allow / ask / deny、external_directory 和会话级匹配授权 | 采用清晰的三态策略与有作用域的额外目录授权。[Permissions](https://opencode.ai/docs/permissions/) |
| Pi | SDK 分开提供会话、资源加载、工具与模型边界，支持持久历史及 steer / follow-up | 保留当前可替换接缝，补任务生命周期与运行中输入。[SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md) |

这些是参考机制；下面的数据结构、默认权限和分阶段路线是针对本项目的设计判断。

是否直接接入现成 Harness：Codex App Server 可作为以后可选的执行后端；Pi SDK 可作为循环替换候选。当前已有多 provider 和大量领域工具，立即迁移会同时改变工具语义、历史格式、模型适配和权限实现。先建立稳定的宿主协议与验收样例，才能客观比较替换收益。接入任何 SDK 都不免除宿主的权限职责。

## 4. 用户看到的工作方式

### 4.1 新对话无需先选项目

默认直接输入任务。输入区附近显示：

`会话工作区 ▾    标准权限 ▾    模型 ▾`

「会话工作区」菜单提供：

- 继续在会话工作区工作。
- 选择本地文件夹。
- 最近使用的文件夹。
- 后续加入：为 Git 仓库创建独立 worktree。

不选文件夹时，不自动使用应用安装目录、进程 cwd、用户主目录或上一次项目。只有工具需要写文件时才建立该会话的托管目录。产出可预览、打开和导出，重启后保留；不能用「临时」文案暗示会自动消失。

### 4.2 选择文件夹

用原生目录选择器选择目标，并展示规范化后的路径和当前权限范围。「在此文件夹工作」这一用户动作建立资源授权；不再为相同目录的常规文件操作重复弹窗。

默认的标准权限允许编辑该根内的普通文件。敏感文件、目录外资源和需要额外权限的动作另行处理。选择目录不自动执行项目 hooks、安装依赖、连接项目声明的 MCP，也不自动信任可执行配置。

前端不能只提交任意路径字符串让 sidecar 据此造授权。原生宿主应创建不可由模型伪造的选择凭证，Broker 消费后建立 workspace；普通工具参数不能创建或扩大授权。

### 4.3 已有对话更换目录

仅在 Run 空闲时更换。更换后追加明确的工作区切换事件，更新模型环境说明、文件树、工具能力和路径基准；清除旧目录临时授权，检查仍运行的后台作业。

历史消息留在同一对话，但旧产出继续指向原工作区。不要把聊天历史迁入新目录，也不自动复制旧产出。默认优先提供「在此文件夹新建对话」，减少长对话里混用项目的机会。

同一目录可有多个对话。首版对同一规范化工作区采用一个写入 Run 租约，其余写任务排队；外部编辑器仍可能修改文件，所以每次写入还需内容版本检查。独立 worktree 是后续并行开发能力，不是文件系统安全隔离；它还需要单独处理共享 Git 元数据的授权和锁。

### 4.4 额外文件与目录

用户选择单个附件只授权读取那个文件，不能顺带授权父目录。可复制进受控附件存储形成稳定快照，并显示来源。额外目录默认只读，确实需要编辑时再授予写权限。

导出到外部位置由原生保存动作建立单文件写凭证；它不授予 Agent 任意访问该父目录的能力。

## 5. 数据模型与存储

最小模型分成五个实体；不要继续让 Session 同时代表浏览器、项目、目录和任务。

| 实体 | 职责 |
| --- | --- |
| Workspace | 在哪个执行环境、哪些资源范围内工作；managed / folder / worktree |
| Thread | 对话、历史、上下文摘要、绑定的 workspaceId |
| Run | 一次用户请求的执行过程、预算、状态和权限快照 |
| Grant / Approval | 谁批准了什么资源或动作、何时失效 |
| Artifact | 实际产出位置、来源工具、版本与所属工作区 |

示意字段，不是已经存在的接口：

```text
Workspace
  id, kind, environmentId
  displayPath, canonicalRoot, rootIdentity, revision
  additionalRoots[{ canonicalPath, access: read | write }]
  trust: { executableProjectConfig: false }

Thread
  id, workspaceId, dataDir, title

Run
  id, threadId, workspaceId, workspaceRevision
  permissionRevision, toolCatalogRevision, status, budget

Grant
  id, issuer, environmentId, workspaceId, resourceSelector
  actions, scope: once | thread | workspace, expiresAt, revision

Artifact
  id, threadId, runId, workspaceId
  storage: workspace | thread-data, relativePath, contentHash
```

根的身份除了路径，还应尽可能记录卷与目录身份；移动磁盘、目录替换、网络位置改变时重新验证，不把相同路径字符串视作相同授权对象。路径属于 environmentId，Windows 路径不能直接拿给 WSL 或远程环境解析。

建议布局：

```text
AppData/
  state.sqlite                 工作区、对话索引、Run、权限与审计事件
  threads/<thread-id>/          大工具输出、附件、摘要引用、浏览器证据
  workspaces/<workspace-id>/    不选文件夹时的托管工作文件
  browser-profiles/<id>/        按需创建的浏览器身份

用户选择的文件夹/                用户源码与明确写入的任务产出
```

模型 API 凭据保留在系统凭据库，由可信宿主读取；状态库只存 secretId。设置页返回 hasKey/掩码，不把已保存密钥反复回传渲染层。日志、HAR 和附件本身也可能含敏感信息，设置保留期、清理入口和导出范围。

迁移时保持旧 `projects/<id>` 原地可读：把其中 `workspace/` 登记为 managed Workspace；历史仍从旧 dataDir 读取，待显式迁移再移动。没有丢失证明前不删除旧数据，不自动把托管文件复制到用户仓库。

## 6. 权限：两个独立维度、三种常用预设

### 6.1 维度 A：实际资源边界

分别记录：文件读取根、文件写入根、敏感路径限制、可执行进程范围、网络目的地、浏览器身份与站点、MCP 服务及账户、桌面自动化权限。

模型请求 API 的联网由可信宿主负责，不等于模型生成的 Shell 也能联网。文件在工作区内，也可能属于密钥、权限配置或会改变后续执行的文件；不能只看路径和文件大小。

### 6.2 维度 B：何时询问用户

策略只返回 allow / ask / deny。常规、已授权范围内的任务连续运行；遇到资源扩张或有外部影响的动作再询问。

| 产品预设 | 文件 | 代码执行 | 网络与外部动作 |
| --- | --- | --- | --- |
| 只读 | 允许读取授权根内普通文件；阻止项目写入 | 不开放任意 Shell、测试或脚本；仅经审计的查询工具 | 按已有连接与目的地授权；远程修改仍需独立授权 |
| 标准，默认 | 允许读写当前工作根内普通文件 | 在已验证的 OS 隔离边界内运行；边界外请求另审 | 开发流量按目的地授权；发布、发送、付款、远程删除等按动作和用户意图授权 |
| 宿主机权限，高级 | 使用用户明确选择的更宽资源范围 | 可执行未隔离命令，持续显示状态 | 仍受硬性拒绝、凭据范围和外部动作策略约束 |

界面可把「只读」解释成「仅查看」，不应与「让模型先写计划」混成一种语义。是否制定计划是工作流选择，能否写文件是宿主必须执行的约束。

选了标准预设但本机没有可用隔离器时，文件 Broker 仍可执行受控读写；自动运行任意代码不可静默退回宿主。界面应显示执行隔离不可用，用户可修复隔离器，或明确授权某次未隔离命令。这个授权不应升级整个会话。

现有 danger 的含义只是跳过审批，不能直接映射为新的宿主机权限。升级版本时应重新建立对应授权，避免旧状态意外扩大访问面。

### 6.3 审批必须有范围

审批卡片应显示宿主生成的实际命令/参数、cwd、读写目标或 diff、联网目的地、隔离状态及申请原因。模型提供的理由可补充展示，不能替代真实动作信息。

默认提供「允许这一次」「拒绝」，仅在范围能清楚表达时提供「本对话允许此范围」。例如批准某个工作区访问指定 registry，不能变成允许所有网络或所有 npm 生命周期脚本。

凭证绑定 thread/run/tool call、environmentId、workspaceRevision、规范化参数和资源范围。原始命令文本、可执行文件及相关脚本版本改变时，检查既有批准是否仍适用。一次性批准只能消费一次；拒绝、超时、断线不转为允许。

明确的自动化预授权可以持续使用，不必每次询问；它必须由用户建立，并有可查看、撤销的具体范围。不能从聊天摘要中的「用户允许过」恢复权限。

仲裁顺序：产品/组织硬性拒绝 → 当前预设与资源边界 → 用户明确限制 → 有效的范围授权 → 默认 allow/ask/deny。硬性拒绝不能被模型、项目配置或宽泛的「始终允许」覆盖。

## 7. 统一执行入口

建议引入一个 ToolRouter：

```text
UI 操作 / Agent / 自动化
  → 身份与调用来源验证
  → 工具 schema 校验、规范化参数
  → 解析真实资源与副作用
  → PolicyEngine: allow / ask / deny
  → ApprovalBroker: 建立或消费范围授权
  → 再检查版本、资源身份、取消状态
  → FileBroker / Executor / BrowserAdapter / McpAdapter
  → 持久化结果、产出、审计事件
```

工具声明应包含 schema、适用能力、effect resolver、超时、取消机制及执行器。副作用可以有多个，例如 `export_code` 是 `fs.write + process.exec`；写入是否成功和自测是否成功分别记录。

effect resolver 来自可信适配器，不能相信模型提交的 effects、confirm 或 origin。未知副作用默认 ask/deny。审批前先校验参数，防止审批预览与工具最终解析出的动作不同。

仅增加声明仍然不够：所有 fs 写入与 spawn 必须收口。文件工具通过 FileBroker 操作；可执行用户代码、AST 等价验证、runner 和第三方扩展在 Worker 中运行。可信适配器不得自行绕过 Broker 启动宿主代码；静态检查禁止在批准模块之外直接导入 child_process。对插件代码的约束还需要进程隔离，不能依赖这条检查形成安全边界。

开发用 `tool-run`、自动化和后台重试也走同一入口。用户直接点击的导出可凭原生选择凭证完成，无需重复询问；不能靠调用方自报 `user: true` 绕过鉴权。

### 7.1 文件路径

应用文件工具应同时检查逻辑路径与实际文件身份。现有 `resolveIn()` 可保留为第一层，但需要处理：

- 已存在文件的真实路径；Windows 的 junction、symlink 和其他 reparse point。
- 新文件最近已存在父目录的身份；目录在检查后被替换的竞争条件。
- 大小写、盘符、UNC、设备路径、alternate data streams 等 Windows 特殊路径。
- 读取/搜索/递归列表时的链接穿透；循环链接、超大文件、目录数量与输出预算。
- 被硬链接的已有文件：严格模式对不明确的多链接写入拒绝，或使用受控的替换写语义。

首版可保守拒绝跨根链接和未支持的特殊路径。需要更强保证的操作用原生文件句柄与相对目录句柄实施检查，避免仅靠 realpath 后重新按字符串 open。隔离 Worker 是命令文件访问的另一个强制边界。

应用状态、权限库、Profile 和凭据存储不能因用户选了其父目录而自动暴露给模型或 Worker。运行依赖和系统库采用明确的只读运行时范围；可写缓存、HOME/TEMP 等落到工作区专属位置，避免为方便运行授权整个用户目录。

### 7.2 进程与网络

Executor 统一处理启动、流式 stdout/stderr、超时、取消、后台作业、完整进程树回收和输出上限。jobId 绑定 Run 和 Workspace，不能用任意 PID 结束其他进程。

所有后代进程继承同一隔离边界。审批过一个外层命令，不代表其子进程可自由越界。命令解析用于说明与缩小审批范围，不承担安全隔离；`git`、`npm`、`python`、`node -e` 都可能间接执行其他代码。

用最小环境白名单构造子进程环境，明确传入必要 PATH、系统变量和本 Run 的 HOME/TEMP。单凭变量名正则剔除秘密不足以控制配置文件、凭据助手、IPC 和磁盘访问。凭据由宿主代理在授权目标上使用，尽量不注入任意执行环境。

Shell 网络由真正可强制的 OS 限制与代理共同控制，不能只设置 HTTP_PROXY。区分包下载、网页访问、模型请求、SSH/数据库和本机服务；localhost、内网、云元数据地址也需要单独处理。新目的地可以按域名/协议/端口合并审批。

依赖安装属于代码执行与联网的组合。默认优先关闭安装生命周期脚本，确有需要再按范围批准；包管理器的全局安装和写宿主配置不属于普通项目安装授权。

## 8. 跨平台隔离器的取舍

宿主控制面保留密钥、审批、模型请求和持久状态；受限 Worker 执行模型生成的代码。Tauri capabilities 限制渲染层 IPC，不能自动限制 sidecar 启动的 Node/Python。

建议定义统一接口：`probeCapabilities / exec / cancel / dispose`，返回实际支持的文件读限制、写限制、网络控制、进程树与后台服务能力。预设只使用已验证的能力，不能把部分能力标成「已完整隔离」。

- **Windows 优先做验证原型。** Codex 官方目前说明了 MXC 与两种 legacy 后端；兼容性、读限制、网络控制和常驻子进程行为不同。这是可参考的工程实现，不能当作我们可直接调用的稳定通用 SDK。[Windows sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox)
- **评估开源隔离器的固定版本。** Anthropic 的 sandbox-runtime 可以作为候选，其上游 README 列出了 OS 级文件与网络限制及 Windows 实现，但标为研究预览并有平台限制。接入前需要核对源码、许可证、打包、安装权限和真实绕过测试；不能仅凭支持列表宣布 Windows 就绪。[sandbox-runtime](https://github.com/anthropics/sandbox-runtime)
- **Linux/macOS 同协议、分别验证。** 可评估上述 runtime 的对应实现；进程、网络、文件链接及后台服务测试必须在实际目标平台运行。
- **WSL/容器作为显式可选执行环境。** 挂载路径、工具链、网络与 UI 所示目录要一致。不能悄悄把 Windows 任务切到另一环境，也不能把容器挂载整个用户目录或 Docker socket 后仍称为受限工作区。

第一阶段不自研一整套跨平台沙箱，也不承诺默认安装环境都具备相同隔离强度。先固定一个可验证的 Windows 后端，跑通真实项目的安装、测试、构建和开发服务器，再决定正式依赖。

## 9. MCP、浏览器和项目扩展

### MCP

服务启动权限与工具调用权限分开。启用 stdio 服务本身就会运行程序；首次启用或 command/args/版本改变时，先展示并确认启动配置。尽可能在有独立资源范围的 Worker 中运行，环境变量只给该服务需要的项。

工具以服务身份 + 原始工具名 + 描述/schema 指纹建立稳定标识。工具说明和 annotations 是不可信提示，不单独据此授予只读权限。未知工具按有副作用处理，用户可按明确工具/账户/资源范围授权。服务更新和权限扩大时让旧授权失效。

外部 HTTP MCP 的远程副作用无法由本机文件沙箱约束，仍须调用策略、账户范围与审计。全局连接管理可以复用，但不能把一个对话的授权自动扩散给所有对话。

### 浏览器

浏览器按需实例化；浏览器启动失败不影响纯文件任务。网页控制、抓包、逆向能力形成独立工具包，只有需要时加载。Cookie/Profile 属于独立的身份资源，不能简单假设浏览器是一次性的、所有操作都没有账户影响。

普通网页浏览尽量连续进行；上传本地文件、提交表单、发送消息、远程删除、使用登录身份等按副作用和用户任务授权处理。页面文本只能提供证据，不能批准命令、增加文件根或连接本机控制接口。

内嵌浏览器/网页预览与应用管理 UI 隔离，远程页面不共享 Tauri 原生命令和审批通道。模型生成的 HTML 预览也属于不可信内容。保留现有 Markdown 清理与 CSP，并检查预览是否会继承本地 RPC 能力。

### AGENTS.md / Skills / hooks

在授权根内读取适用的 AGENTS.md，并记录来源与作用目录；这些文字能约束工作方式，不能放宽宿主权限。无文件夹时不扫描用户整个主目录找指令。

项目推荐的 Skill、hook、MCP、可执行配置先列出来源，再由用户选择启用。项目配置可以收紧策略，不能自行改成宿主机权限、关闭审计或读取密钥。工具包与 Skill 的加载控制上下文大小；真正执行仍经过同一个 Broker。

## 10. Harness 工程还要补的运行能力

### 10.1 可恢复的 Run

建议状态为 queued / running / waiting_approval / waiting_user / completed / failed / cancelled / interrupted。把「请求接受」「模型停止」「工具成功」「任务验收通过」分别记录。

UI 订阅带递增序号的 RunEvent；重连按序号补发，审批卡片从后端状态恢复。使用 SQLite 事务记录关键状态与事件，大输出保存为受保护的内容引用。现有 History 的模型上下文视图继续复用，通过适配层读取已提交事件。

每次有副作用之前持久化 invocation 和批准范围，完成后立即提交结果。崩溃留下 started 但无结果的调用，标为 interrupted/unknown；修改文件、发送请求、发布等不能盲目重放。远程系统支持幂等键时使用稳定键，否则先核对实际结果。

恢复 Run 时重新验证目录身份、环境能力、策略版本和待审批内容。用户未批准的请求在重启后仍未批准；旧进程不凭一个过期 PID 自动认领。

### 10.2 取消与后台服务

取消应传播到模型请求、审批等待、工具和进程树，并等待必要的清理完成。保留后台服务需有显式所有权与最大存活期；关闭对话、退出应用、撤销目录权限分别定义清理行为。

运行中用户输入支持「本轮补充」和「下一轮排队」。在工具边界读取补充；不能让 UI 的输入禁用成为唯一的并发控制。

撤销权限后停止新调用；已有 Worker 可能还保有文件句柄或旧网络能力，需要终止或重建，不能只修改内存里的允许集合。

### 10.3 代码改动可审阅

记录 Agent 写文件前的版本与 after hash，展示 diff。写入使用预期版本检查，冲突时重新读取。撤销仅适用于仍匹配 Agent 写后版本的改动，不能覆盖用户之后的编辑；不使用整仓库 reset 作为通用撤销。

Shell 可能修改多个文件，工具的 `wrote` 数组不足以完整记录。结合限定范围的文件变更观察与 Git diff 展示，并明确外部副作用不能按文件快照回滚。

### 10.4 工具与上下文预算

默认提供少量核心工具：文件读取/搜索/受控编辑、执行、提问、任务状态、产出。网页、抓包、AST/VMP 和 MCP 工具通过能力发现按需加入；省略定义不等于授权拒绝，ToolRouter 必须再次检查。

把当前 system prompt 中具体逆向流程、默认 todos、AUTO_PROMPT 和预算耗尽后的逆向总结模板，移到逆向工具包。通用内核只说明当前环境、可用资源、用户目标与通用执行规则。

保留现有压缩与长输出引用机制，增加每 Run 的 token、时间、工具调用、输出和文件扫描预算，以及重复失败检测。敏感完整输出不要因为压缩而进入另一条未受保护的存储路径。

### 10.5 自动化复用相同 Runtime

计划任务绑定 workspaceId、任务 prompt、权限预设与明确预授权范围；触发后建立 Run，不强制启动浏览器、不自动抢占焦点。

调度器等待 Run 进入最终状态后才记录成功。需要新权限时进入 needs-attention/等待批准，通知用户；无人值守不意味着获得更高权限。相同工作区的写任务遵守相同租约和并发规则。

## 11. 实施顺序与验收

| 阶段 | 改动 | 退出条件 |
| --- | --- | --- |
| P0：收口现有副作用 | 修正未知 MCP 默认放行、导出内含执行、各 runner 环境继承；调用统一鉴权入口 | 所有执行路径可枚举；未授权执行不会因工具名称被放行 |
| P1：工作区模型 | 拆 dataDir / workRoot；原生选目录凭证；managed/folder；旧会话兼容；只读与文件版本检查 | 不选目录、选目录、重启恢复、附件与导出都能正确工作；纯文件操作不依赖浏览器 |
| P2：受限执行 | Windows 后端原型、能力探测、范围授权、统一 Executor、取消和进程回收 | 标准权限下命令实际无法越界读写或绕过网络；不可用时不静默降级 |
| P3：任务与审阅 | Run 状态/事件持久化、审批恢复、diff、输入排队、工具按需发现、通用 prompt | 崩溃后能解释已发生/未知副作用；用户能看懂并撤销可撤销的改动 |
| P4：扩展场景 | 自动化迁移、项目扩展信任、worktree、其他 OS 与可选 Harness 后端 | 各入口通过同一套权限与生命周期测试 |

P0/P1 可逐步发布，但 OS 隔离验收前，不能将开放任意代码执行的标准模式描述为「只能访问工作区」。若优先支持目录内编码，第一批就应把 P1 与 P2 做成可用的纵向切片。

首批文件职责建议：

- `sessions.mjs`：拆出工作区登记与 thread dataDir，保留对话生命周期。
- 新 `workspaces.mjs`：目录身份、绑定、切换与兼容旧 managed 目录。
- 新 `toolrouter.mjs` / `permissions.mjs`：参数规范化、effects、策略与批准范围。
- 新 `executor.mjs` 与平台 adapter：统一启动、隔离、输出和取消。
- `workspace.mjs` / `localtools.mjs` / `mcphost.mjs`：移除各自直接执行宿主代码的旁路。
- `history.mjs` / 新 RunStore：保留上下文视图，补事务化运行事件。
- `src-tauri/src/main.rs`：原生选择凭证、必要的受控 OS 能力。
- `ui/src/chat.jsx` / `shell.jsx` / `bus.jsx`：工作区选择、权限状态、结构化审批和运行事件。

必须覆盖的验收不是「模型答应不越界」，而是执行结果：

| 场景 | 预期 |
| --- | --- |
| 无目录创建脚本、重启后续做、导出文件 | 使用 managed 工作区并保留产出 |
| 选择仓库后读代码、修改、安装、运行测试 | 文件根正确；执行范围和联网范围可见且受控 |
| `../`、相邻前缀、symlink/junction、替换父目录 | 文件工具与命令均不能穿透授权根 |
| 当前根内链接指向外部密钥、模型尝试读取应用状态 | 被实际拒绝 |
| 只读模式执行脚本、测试、导出后自测 | 不因工具名称或「仅测试」理由获得写/执行能力 |
| 允许一次命令后更改参数、切目录或更换 MCP 定义 | 旧批准不扩散、不复用 |
| 未知 MCP 写入或安装自动启动程序 | 先经独立启动/调用授权 |
| 安装脚本、Node/Python 子进程访问外部路径/网络 | 后代进程保持同一限制 |
| Worker 请求 localhost 控制接口、访问未授权内网 | 被网络边界拒绝 |
| 用户取消或撤销权限 | 等待停止；进程树与已有能力被回收 |
| 执行中崩溃、审批中重启、远程调用结果未知 | 状态可解释，不自动批准或重复副作用 |
| 自动化投递成功但模型/工具失败 | 记录实际失败，不记完成 |
| 两个对话和外部编辑器同时改同一文件 | 按租约/版本处理，用户修改不被盲目覆盖 |

这些涉及权限边界的测试需要真实进程与真实 OS 后端；纯策略单元测试不能替代它们。

## 12. 本次验证记录

运行：

```powershell
cd sidecar
node --test --test-reporter=tap test/policy.test.mjs test/paths.test.mjs test/loop.test.mjs test/history.test.mjs test/workspace-agent.test.mjs
```

结果：49 项，47 通过，2 失败，无跳过。

- `workspace_grep respects glob and path`：期望 `nested/b.js` 格式的断言失败，当前 Windows 路径输出需统一。
- `workspace_shell does not pass WDH_LLM_API_KEY to the child`：返回 exit 0 但没有预期的 `EMPTY` 标记，无法据该用例确认子进程执行与输出符合预期。独立的 childEnv 单元测试通过；不能把这次失败表述为已经发现密钥泄漏。

本次没有修复这两项，也没有运行桌面端或真实沙箱验收。既有测试通过部分只能证明当前用例行为，不能证明上述权限边界已经实现。
