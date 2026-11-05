# 跨设备交接

当前产品分支：`decrypthub/dsh-product-20261104`，远端：`https://github.com/decrypthub/DecryptHub.git`。这是 Electron / DSH 主干；旧 Tauri 代码留在同一远端的 `handoff/ui-alignment-20261104` 分支。

## 在另一台电脑接续

```sh
git clone --branch decrypthub/dsh-product-20261104 https://github.com/decrypthub/DecryptHub.git DecryptHub-DSH
cd DecryptHub-DSH
pnpm install --frozen-lockfile
```

需要 Node.js >=24.9.0 和项目固定的 pnpm 11.28.5。先阅读 `PRODUCT-DESIGN.zh.md`、`DECRYPTHUB.zh.md` 和 `AGENTS.md`。

需要旧版设计或实现时，另外克隆 `handoff/ui-alignment-20261104` 到平级目录 `DecryptHub-Desktop`，不要把它合并到新主干。

WDH 独立运行时：`https://github.com/decrypthub/WebDecryptHub.git`，本次依赖分支 `codex/github-token-for-kernel-download`，提交 `b937d45`。建议克隆到平级目录 `WebDecryptHub-Runtime`。打包 Desktop 前先按该仓的组件构建文档生成 WDH，并将 `DSH_DESKTOP_WDH_COMPONENT_DIR` 指向组件产物；本机产物目录不随 Git 携带。

## 当前实现与待完成项

已接入品牌及独立数据目录、DecryptHub 社区登录、三种自定义 API 格式、英文思考强度滑杆、自定义 MCP、官方 WDH / ADH / IDH 管理与校验安装。保留 DSH 供应商目录、官方 API 适配器、Agent 预设、团队与开发者工具；关闭官方账号入口、首启公告、官方密钥自动引导、遥测及会话上传。

全局记忆与系统记忆管理页、专用 DSH 插件配置导入、WDH 内嵌浏览器/抓包/调试工作台尚未迁移。真实设备连接、官方组件真实发布下载及生产账号接口尚未完成端到端验证。

开发窗口在后续构建时出现过根插槽热重载错误并变成空白；本轮通过固定安装包避免该交付问题，没有修复上游热重载生命周期。不要边让用户体验开发窗口边重建工作区产物。设置绝对路径 `DSH_DESKTOP_BUILD_ROOT` 可隔离整套准备目录和安装包，随后运行打包产物。

## 验证状态

最近已通过完整构建的 10 项检查、MCP 相关 18 项测试、构建路径 17 项测试、相关重连/只读启动定向复验、关键构建启动与 Worker 预览、43 项文档校验。固定安装包还通过原生模块、离线插件安装移除和文档转换检查，并实际打开新会话、官方组件及 MCP 设置、冷启动复查。

整套 GUI 曾出现 13 个文件、64 项失败；本轮新增的提前订阅问题已修复并定向复验，其余旧账号、设置及主题断言还需整理。最终源码未重跑整套 GUI / 所有 Web 场景，不应当作已通过全量回归的发布版。末次本地预览构建后只修改了构建路径测试和交接文档。

本机应用数据、账号凭据、设备配置、`.tmp/`、`.desktop-build/`、浏览器内核及安装包均不进入提交。换机后需自行配置模型和设备连接；不要复制或提交凭据文件。
