# UI 对齐交接 — 2026-11-04

## 当前方向

用户已选择 **改用 DSH 主干**；后续主要开发位置切至 `../DecryptHub-DSH`，见 [主干迁移记录](dsh-mainline-transition-20261104.md)。本仓输入法、窗口快捷键和两处布局问题已止损修复并验证，自动化随新主干整体继承。以下为旧主干各轮历史记录。

最新思考强度选择器按用户的 ChatGPT 参考图改为胶囊滑杆，移除复位和全部档位文字行，详见 [滑杆修改记录](thinking-slider-20261104.md)。独立 release 入口 `.tmp/thinking-slider-20261104/DecryptHub 思考滑杆测试.app`；没有替换用户正在测试的上一版，先退出旧窗口再启动。

最新为 [运行交互修正与复验](ui-runtime-followup-20261104.md)：恢复冷态上下文、系统记忆正文、三种 API 格式、英文思考档位、Agent 建立后才出现的团队入口、运行中插话、稳定 Markdown/阅读位置，以及本轮文件卡片。独立 release 入口改为 `.tmp/ui-runtime-followup-20261104/DecryptHub 交互修正测试.app`；原生隔离窗口已实际操作并冷重启复验。旧测试窗口没有被替换，关闭旧窗口后再打开新包。UI 81/81、专项 18/18；全量 sidecar 仍有失败，见新记录。以下各段为前序阶段的历史交接，不代表最新行为或测试结果。

2026-11-04 七项截图反馈后续：分支图标、命令高亮与分组菜单、压缩单行反馈、文件路径及移除 Git 页、子代理可进入/继续、智能体团队共享任务板已实现。参考源码、实现差异与未通过的基线测试见 [七项界面对齐记录](ui-seven-points-20261104.md)。新增独立本机 release 入口 `.tmp/ui-seven-points-20261104/DecryptHub 界面对齐测试.app`；它沿用现有测试数据，先关闭旧窗口再打开，未覆盖用户正在运行的旧包。本轮改动尚未提交或推送。

2026-11-04 Mac 后续：已克隆官方真实源码 `8bd073392eef6f54e921a093b95076248eb08cbb` 并完成一轮实现对照，新增 scoped 双 Escape/队列保留、工具卡片及阅读位置修正。本机浏览器中的真实 sidecar/shell 可见复验已完成，覆盖停止、排队保留/手动继续、刷新/切换恢复、真实失败与窄视口。代码、参考文件行号、基线测试对照和平台验收边界见 [源码对齐记录](ui-source-alignment-20261104.md)。下文保留原交接事实；不能把本机浏览器验证视作 Windows 发布版复验完成。

用户已明确：此前主要对齐核心 Agent，接下来重点对齐 **UI 细节与实际操作体验**，尤其是命令执行时的对话交互。本次先收尾并推送，供另一台设备继续；不要把未复验的改动当成已验收，也不要重新从头做一轮核心架构重写。

参考仓库为 `https://github.com/deepseek-ai/deepseek-harness`，本次阅读位置 `ce7073d512`。参考仓只读。本产品名 DecryptHub；自研浏览器组件 WDH、插件市场范围和 Agent 预设选择继续遵守已有产品策略。UI 仍须读参考实现代码，再对真实发布版操作。

## 已保存的代码

- 前几轮核心对齐：环境与资源发现、规则/记忆/技能、工具、终端/持久 PowerShell、计划、目标、子代理、模型/供应商、历史与项目管理、压缩日志、检索与分支、Office 资源。依据与验证边界见 `dsh-parity-20261103-r4.md` 及前序审计。
- 共享目录并发：移除整项目目录的任务独占；同目录多个会话可运行，单会话运行保护、历史写租约、文件版本检查保留。实际发布版 UI 已验证，见 `dsh-parity-20261104.md`。
- 本轮 UI：补齐 PowerShell 命令摘要和终端工具名称；有草稿时主按钮发送到下一轮队列，空草稿时保持停止；显示明确的退出码，区分后台、等待输入、等待超时与未确认结束；旧渠道的 `hasKey` 不再误触发“尚未配置模型”。
- 本轮 UI 后续修正：删除工具 body 和整个过程列表的两层额外滚动容器，输入/输出保留独立滚动；工具被运行取消时保存可选 `cancelled` 标记，实时更新与历史恢复一致，主动停止不再计为普通失败。原始错误回执保留，不重写模型历史。

## 已验证与待复验

已验证：

- 最近专项 **7/7**，覆盖工具名称/命令摘要、明确失败退出、终端等待/后台/畸形结果回退、实时与历史回放、真实 Agent 取消回执及写盘重读。
- UI 构建、静态审计、Windows native release、实际 sidecar 构建成功。
- 使用隔离数据、本机 HTTP 模型夹具和真实 PowerShell/PTY，从发布版 UI 发出长命令；输入补充要求后，点击“加入下一轮队列”没有中断当前命令，排队消息在本轮结束后执行。
- 发布版实际显示退出码 7 和“失败 1”；真实 terminal_send 的等待结果显示“等待超时 · 未确认结束”，没有将其解释为命令成功。

**最后两处的最终 UI 复验尚未完成**：取消标记/停止行与减少滚动层级已通过专项及最终编译，但用户在启动最终复验时要求转为收尾、推送。下一台设备先验证这两条，不要写成已通过。

一次 UI 单元测试扫描为 64 项：61 通过、3 失败，均在未改动的 `ui/test/chat-scroll.test.mjs` 的贴底断言。该文件用普通数字字段模拟 scrollTop，期望值包含 scrollHeight；真实 DOM 可滚动底部为 scrollHeight-clientHeight。应结合真实 UI 判断，不能修改断言来刷绿。本轮后加的取消写盘专项计入前述 7/7；没有再次跑完整扫描。更早的后端全量夹具失败基线详见 r4 文档，不能宣称全量测试已绿。

## 下一步的最短路径

1. 验证“执行命令 → 填补充要求 → 点击发送/Enter → 队列执行”；比较有、无草稿时的主按钮，与等待批准/回答时的交互。
2. 验证长输入/输出展开、滚动、切换会话、重开历史，确认只有需要的区域独立滚动，阅读位置不被输出抢走。
3. 实际启动并停止长命令，核对工具行、轮次摘要、进程退出及重开后的状态；真实命令失败仍应显示退出码和失败，用户取消显示已停止。
4. 继续检查工具输入/输出卡、折叠、最终回复出现的位置、等待状态、错误回执、复制和窄窗口。参考重点：`ui-tool` 的 `tool-call-model.ts`、`terminal-card-model.ts`、`ToolRow.tsx`，以及 `ui-conversation` 的 `InputBar.tsx`、`submission-policy.ts`。
5. 后续尚未对齐的输入细节包括 busy-Enter 的 queue/steer 设置与双 Escape 停止路由；不要用一个简单 Escape 监听替代参考实现的会话/焦点/弹层/连续按键约束。

主要入口：`ui/src/chat.jsx`、`conversation.js`、`tool-execution.js`、`state.js`、`bus.jsx`、`app.css`；取消回执来自 `sidecar/agent.mjs`。本轮没有扩充插件市场或 Agent 预设。

## 换设备准备

```powershell
git clone --branch handoff/ui-alignment-20261104 https://github.com/decrypthub/DecryptHub.git
cd DecryptHub
npm ci
npm --prefix sidecar ci
npm run build:ui
npx --yes bun@1.4.4 scripts/build-sidecar.mjs win
$env:CARGO_TARGET_DIR = Join-Path $PWD 'src-tauri\target'
cargo build --release --manifest-path src-tauri/Cargo.toml
```

需要 Windows x64、Node 24、Rust stable、Visual Studio C++ 构建工具和 WebView2。Office、Python/Node/pnpm、搜索和终端资源由构建脚本按锁文件准备；首次构建会下载资源，不能依赖本机缓存。其它平台的完整桌面包尚未验收。正式体验使用 release；不要用 HMR 与源码侧车给用户验收。

源代码与依赖锁文件、许可及 Office 技能一并提交。安装包、node_modules、build、target、隔离数据和本机证据不入 Git。本机 `BASELINE.md` 是未跟踪的历史环境快照，不作为另一台设备的前置依赖。

**代码推送不迁移个人数据**。真实项目/聊天/设置在 `%APPDATA%\DecryptHub`，凭据在 Windows 凭据库；不要把这些提交到仓库。换设备要另行配置供应商和 WDH 组件。测试使用独立的绝对 `DECRYPTHUB_DATA_DIR`，避免真实数据混入。

源码版本为 1.5.0。本机桌面的 2026-11-03 安装包没有包含 11-04 的修复；本次收尾不重新打包、不替换用户当前安装、不创建线上 Release/tag。该分支是继续开发的交接快照。

本机证据（不随 Git 分发）：聚合目录 `.tmp/command-chat-ui-20261104/` 的 `targeted-final.txt`、各 final 构建日志、`ui-draft.txt`、`ui-results.txt/jpg` 和 `ui-stop-before.txt`。后者记录的是修复前主动停止仍计失败的复现，不能当成修复后的验收。
