# 插件中心验收（2026-10-25）

- 核心测试 182 项：181 通过，1 项因当前机器缺少完整 OS 执行隔离后端跳过。插件测试覆盖固定仓库/平台选择、校验失败不激活、重定向限制、取消、版本比较、MCP 配置与命名空间、凭据脱敏和运行期间变更保护。
- 停用后的 WDH/网关更新保持停用；关闭浏览器期间取消不会激活；网关启动参数异常或保存配置失败会保留原激活版本与配置。
- UI 生产构建、Radix 控件审计及浅深色契约通过；插件页沿用顶部原生拖动协议。
- 真实界面从三个官方 GitHub Release 下载 WDH、IDH、ADH，完成 ZIP 限制、完整 SHA-256 校验和安装。IDH/ADH 通过本地 HTTP 设备样本接入 MCP；自定义 MCP 通过界面添加、启动并显示真实版本。
- 保存旧模型设置快照不会覆盖新增的 MCP 配置；停用 WDH 后浏览器工具从工具表移除。
- 实际下载的 WDH 组件已启动系统浏览器、读取本地网页并抓取响应体。浅深色截图位于本地 artifacts/plugins，不随源码提交。
- IDH 38 项 Python 测试、ADH 5 项测试及两端 Windows/Linux CI 通过。WDH Windows/Linux 组件构建 CI 通过。
- 官方预览安装包分别由 WebDecryptHub、idh-cli、adh-cli 的 GitHub Releases 提供。WDH 发布 Windows/Linux x64 包，网关使用 Python 3.10+；设备端与 Host Daemon 仍由用户自行准备。

## 真机后续验收

2026-10-25 已使用实际手机完成独立于模拟服务的验证：

- IDH：真实设备 CLI 发现、能力/统计调用；官方 0.7.0 网关经桌面 RPC 保存配置，MCP 报告设备引擎 1.27.5、47 个工具；通过 Agent 工具路由读取能力和统计，前后 PID 相同。
- ADH：专用 Android 测试设备的既有 Sandbox Agent 连接真实 Host ADH Daemon；CLI 进程列表、官方 0.1.2 网关、桌面配置与 Agent 的进程列表/能力/连通性探针通过；MCP 枚举 86 个工具，前后 session/PID 保持一致。
- 本机已有 SSH 密钥可登录用户指定的 iOS 设备，仅检查了连接身份和系统类型，没有修改手机配置。

此验收覆盖设备连接及所列只读工具，不代表所有 Hook、Trace、导出或复杂目标分析能力均已真机验收。真实地址、App 数据、SSH 连接材料与本地验收报告不提交；可通过 `check:mobile` 在准备好的设备环境重做。

下载完整性依赖固定官方 GitHub 仓库、HTTPS 与 GitHub API digest，不声称已有独立发布者签名。核心 SRT 依赖链原有 3 条 high、Windows OS 隔离后端与多屏/IME 完整验收仍按 security.md 跟踪。
