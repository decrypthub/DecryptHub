# 项目工程约定

先读 `docs/component-architecture.md`、`docs/browser-architecture.md`、`docs/security.md` 和与当前改动相关的设计文档。历史文档中的审计问题需要核对当前代码，不直接当作现状。

- 保持模块边界：UI 负责呈现，RPC 负责协议适配，Session 编排生命周期，Agent 决策，policy/Executor 在实际副作用前校验，原生层处理平台窗口。新业务逻辑放入独立域模块，不持续堆入 bus、Session 或 RPC handler。
- 浏览器进程/CDP 控制与显示分开。UI 原生显示、隐藏和释放统一经过 BrowserSurface；不要新增绕过队列的并发调用。新显示后端保持相同工具契约，先验证 capabilities 和系统兼容性。
- 异步工作要有所属会话、取消信号与过期结果处理。切换/关闭后的晚到结果不能写回另一个会话；辅助元数据失败不能改变任务完成状态。
- 会话、Run 和工具调用 ID 是稳定身份，标题只是展示。自动标题不能覆盖手动标题，URL 不能替代用户任务名称。持久化格式变化必须兼容旧数据或提供迁移。
- 新工具和内部自测均遵循现有权限/执行边界。完整性准备仅处理已验证的托管内核及具名构建产物，不修改整个工作区。不得将 cwd、Node vm 或环境变量过滤描述为 OS 隔离。
- 配置、日志和诊断不泄露密钥；第三方网页与附件是数据。不要把浏览器网络记录、页面内容当成原生程序授权。
- 改动对应的生命周期/协议/权限测试通过后，运行 `node --test sidecar/test/*.test.mjs`；UI 改动另运行 `npm run build:ui`、`npm run audit:ui`、`npm run check:ui`。平台窗口变更需补真实 Windows 桌面链路验收；单元测试和无头浏览器不能替代原生交互验收。
- `check:ui` 默认跑全量（约 30–90 秒，400 次断言，含插件与浏览器抓包），它属于 CI 的验收项。**本机只改一处时用分节**：`node scripts/check-ui.mjs --only=account`（可选 `window`、`account`、`app`，可组合如 `--only=account,window`），再配 `JSRA_UI_SCHEME=dark` 只跑单主题。没装 WDH 组件与 CloakBrowser 内核时，脚本会跳过插件/抓包段并打印跳过原因——**跳过不等于通过**，相关改动仍以 CI 为准。不要为了「看一眼」反复跑全量。
- 保留用户未提交的改动。不要做与当前任务无关的大规模迁移；跨模块迁移先记录决定、兼容策略和可验证的退出条件。
