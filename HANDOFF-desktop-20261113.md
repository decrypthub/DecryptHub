# DecryptHub 桌面端 — 交接单（2026-11-13）

给接手的 Agent/工程师。先读这份，再读仓库自带的 `AGENTS.md`、`PRODUCT-DESIGN.md`。

---

## 1. 一句话现状

`DecryptHub-DSH/` 是 DeepSeek-Harness 的产品 fork（Electron 39 + Cordis 内核），分支 `feat/dsh-rc1`。桌面端功能已做到「本机可用、安装版可验」，**但整仓 402 个文件未提交**，交接的第一件事就是决定怎么落地这些改动。

| 项 | 值 |
|---|---|
| 分支 / HEAD | `feat/dsh-rc1` @ `57d0e53552` |
| 已装版本 | `0.2.2-rc.1.20261113.21`（`%LOCALAPPDATA%\Programs\DecryptHub`） |
| 包内版本号 | `apps/desktop/package.json` 与根 `package.json` 均为 `0.2.2-rc.1`，构建时用 `--build-version` 追加日期序号 |
| 未提交 | 402 项（含他人未完成改动，见 §5） |
| 门禁 | `pnpm run typecheck` → `run-gates: 5 passed, 0 failed`（注意 PowerShell 下退出码为 1 是 stderr 导致，看输出为准） |

---

## 2. 环境与命令（本机已验证）

```powershell
# 依赖
pnpm install --frozen-lockfile        # Node >= 24.9，pnpm 11.28.5

# 门禁
pnpm run typecheck                    # 看 "run-gates: N passed"
pnpm exec vitest run packages/client/ui-mcp packages/mcp/decrypthub-components packages/mcp/decrypthub-integrations

# 改了 @Remote 签名之后必须重新生成 typert 产物，否则 client tsc 报“属性不存在”
pnpm exec tsx scripts/build.ts --scope artifacts

# 打安装包（约 5-8 分钟；TEMP 必须指到工作区，否则 esbuild 删临时文件 Access denied）
$env:TEMP='X:\Project\github\DecryptHub-all\.tmp\build-temp'; $env:TMP=$env:TEMP
$env:DSH_DESKTOP_SKIP_SMOKES='1'
pnpm --filter @deepseek-ai/dsh-desktop run package:win:x64:unsigned -- --build-version 0.2.2-rc.1.<日期>.<序号>
# 产物：apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts/*.exe

# 安装（不能从 X: 盘直接跑安装器，会写不进 AppData）
Copy-Item <exe> "$env:LOCALAPPDATA\Temp\install.exe"
Start-Process "$env:LOCALAPPDATA\Temp\install.exe" -ArgumentList '/S' -Wait
```

**启动产品前必须清掉** `DSH_HOME`/`DSH_PROFILE`/`DSH_PROFILE_DIR`/`DSH_SESSION_ID`/`DSH_SHELL`/`DSH_WEB_URL`/`ELECTRON_RUN_AS_NODE`，否则产品会去读官方 Harness 的数据目录，表现为「插件和会话都不对」。

**CDP 验收**（唯一可靠的 UI 断言手段，脚本在 `.cdp-tools/cdp.mjs`）：

```powershell
Start-Process "$env:LOCALAPPDATA\Programs\DecryptHub\DecryptHub.exe" -ArgumentList '--remote-debugging-port=9223'
node .cdp-tools\cdp.mjs eval '@.cdp-tools\q-cards.js'   # @ 前缀读文件里的表达式
node .cdp-tools\cdp.mjs click <x> <y>
node .cdp-tools\cdp.mjs shot out.png
```

---

## 3. 本轮做完的（可交付）

### 3.1 官方组件（WDH / ADH / IDH）交互重做

用户定的模型，**不要再改回去**：

1. 开关关闭 = 未开启。
2. 开启但未安装 → 打开弹窗引导安装（不写配置、不报错）。
3. 已安装 → 弹窗里配置：WDH 选浏览器内核；ADH/IDH 填设备地址、选默认设备、删除设备。

实现要点：

- 卡片：状态点 + 一句话（未连接显示版本；连上显示「N 个工具可用」）。
- 弹窗「快速配置 | JSON」两页签。**JSON 只显示本组件自己的条目**（WDH 只显示 `wdh`），保存前用 zod 校验。这条被用户明确骂过一次。
- 设备列表 `devices: string[]` 存在 `decrypthub-integrations` settings；客户端一次 `settings.mutate` 写全 `enabled/command/args/endpoint/devices`；添加设备即启用组件。
- `configure` Remote 保持 7 参数（加参数要重跑 `build:artifacts`）。
- 列表页顶部有刷新图标（`source.reset()` 重建两条观察流）。

### 3.2 工具计数与工具列表

新增 `measureTools(id)` Remote（`packages/mcp/decrypthub-components/src/index.ts`）：

- 临时 stdio 启动组件的 MCP server → 列 `toolNames` → 立刻关闭；不占连接、不进 agent、结果缓存。
- WDH 必须带 `--data-dir` / `--kernel-dir`；ADH/IDH 必须走 `runtime()` 拿到的 `command/args/env`（本机是 `adh.exe` 这类 CLI，**没有** managed 安装包，不要用 `files.resolve` 做前置判断）。
- 客户端 `ComponentsSource.observe<T>()` 现在有返回值（原来丢弃），弹窗 `toolsSection()` 两个分支共用。
- 实测：WDH 16、ADH 91；IDH 未配置设备时读不到（正确行为）。

### 3.3 其它

- MCP 空状态：`McpEmptyIllustration` + 标题 + 说明 + 描边按钮。
- WDH 会话内状态条 `WdhStatusPill`（`conversation.composer.dock`，session 作用域）：连上显示「浏览器已连接」，失败可点重连。
- 「操作失败，请先完成正在运行的任务」已修：根因是 Host `configure` 的 `assertIdle`（有 running agent 就拒），已去掉——启停只影响下一个会话。

---

## 4. 关键文件

| 关注点 | 文件 |
|---|---|
| 组件页 + 弹窗 | `packages/client/ui-mcp/src/client/ComponentsPage.tsx` |
| 组件页样式 | `packages/client/ui-mcp/src/client/Page.module.css` |
| 组件文案（中/英） | `packages/client/ui-mcp/src/client/components-locales.ts` |
| JSON 页校验 | `packages/client/ui-mcp/src/client/config-review.ts` |
| 组件 Host 服务 | `packages/mcp/decrypthub-components/src/index.ts` |
| 工具探测 | `packages/mcp/decrypthub-components/src/tool-probe.ts` |
| 组件 feed / 下载 | `.../src/releases.ts`、`.../src/zip.ts`、`.../src/files.ts` |
| 集成层（每会话挂 MCP） | `packages/mcp/decrypthub-integrations/src/index.ts` |
| 产品组合 | `packages/bundle/web-app/cordis.patch.yml`（另 `mcp-bundle/`、`memory-bundle/` 为新增未跟踪目录） |
| 品牌/身份 | `apps/desktop/src/product-identity.ts`、`packages/bundle/web-app/cordis.patch.yml` 的 `includeHarnessIdentity:false` |

---

## 5. 交接时必须知道的坑

1. **工作树里混着别人的改动**（402 项）。整文件提交会把别人的工作裹进去。落地方案二选一：按文件挑本产品的改动单独提交，或先确认其他人是否还要这些改动。
2. **`.tmp` 会被清理**，辅助脚本放 `.cdp-tools/`（`cdp.mjs` 已在那里）。
3. **改 `@Remote` 签名不重跑 `build:artifacts`**，client tsc 会报「属性不存在」，且运行时会拿旧产物。
4. **PowerShell 写中文脚本容易踩编码**：`write` 工具写的 `.ps1` 无 BOM；`edit` 改带 BOM 的中文文件会按 GBK 解码再写回，导致乱码。用 Node 脚本写文件最稳。
5. **测试用 `fs.symlink` 在 Windows 上 EPERM**：`packages/mcp/decrypthub-components/tests/files.spec.ts` 的 `rejects traversal, symlinks…` 在 HEAD 上就红，是环境权限问题（需开发者模式/管理员），不是回归。交接后可考虑加 `process.platform === 'win32'` 跳过。
6. **`pnpm run typecheck` 在 PowerShell 下退出码为 1**，因为 gate 往 stderr 写东西；判读看 `run-gates: N passed`。
7. **安装器不能从 `X:` 盘直接运行**（写不进 `%LOCALAPPDATA%\Programs`），先复制到本地磁盘。
8. **组件 feed 当前指向测试服** `http://192.168.200.195:18080/components`（`DSH_COMPONENT_FEED` 可覆盖）。接正式源时要换地址并确认 sha256/size 校验仍走同源。

---

## 6. 未完成 / 待决策

- **整仓未提交**（见 §5.1），没有 PR，没有 tag。
- **IDH 未做端到端验证**：本机没有配置 iOS 设备地址，弹窗只能看到「还没有设备」。
- **WDH 内核**：产品默认 `cloak`，但 CloakBrowser 现役版需要 license key，公开 keyless 版只到 v146 且指纹分数反而低（LeakDig 71% vs 系统 Chrome 100%）。建议默认改 `system`，cloak 作为可选。
- **自动更新源**：未配置正式源，只做本机手动升级。`DSH_DESKTOP_UPDATE_ORIGIN` 可指向测试 feed。
- **组件 feed 无签名校验**，只有 sha256 + size + 同源限制。
- **记忆/角色、技能、Harness 数据导入**：已实现（`memory-bundle`、`ImportPage.tsx`、`harness-import.ts`），但本轮未复验，接手后需重新跑一遍真实数据导入。

---

## 7. 接手第一小时建议

```powershell
cd DecryptHub-DSH
git status --porcelain | Measure-Object -Line        # 确认脏文件数仍是 402 左右
pnpm run typecheck                                    # 期望 5 passed
pnpm exec vitest run packages/client/ui-mcp packages/mcp/decrypthub-components packages/mcp/decrypthub-integrations
# 期望：1 failed（Windows symlink 环境问题）+ 34 passed
```

然后装一次当前产物、打开「设置 → 技能与 MCP → 官方组件」，确认三张卡片分别显示 `16 个工具可用` / `91 个工具可用` / `可用`，再进弹窗确认 JSON 页只显示本组件配置。
