# 第四轮：剩余核心能力收尾

参考 DeepSeek Harness `ce7073d51254c26cd63b22a60835b8f948deb447`。本轮以主工作区完整树 `e5c63a37f8392774af2b225a7069715cb2fa4c7c` 为基线，在 `.worktrees/dsh-parity` 实施；基线已有 139 项未提交路径。参考仓只读。浏览器、Agent 预设选择及完整插件市场继续按产品要求排除。

## 源码依据与实现

以下路径均相对参考仓的 `packages/`，不是凭文档推测行为。

| 模块 | 实读参考源码 | DecryptHub 实施 |
|---|---|---|
| 冷会话与分页 | `api/session-controller/src/list.ts:1–295`、`history/controller.ts:1–112,220–270`、`history.ts:1–100` | `session-snapshots.mjs`，浏览不创建 Agent；只给当前聊天最近 50 轮，按原始 seq 向前分页。渲染端最多保留 8 个闲置聊天的已加载消息，运行中的聊天不驱逐。快照带事件 revision，快照期间的增量只补比切点新的部分，避免覆盖快速回复。搜索较早消息时继续加载到命中轮次。 |
| 压缩、迁移与提交 | `session/session-persistence-jsonl/src/{zstd,zstd-public-decoder,generation}.ts` 全文及 `storage.ts:238–353` | `history-formats.mjs`、`history-zstd.mjs`、`history-store.mjs`、独立 `history-verifier.mjs`。存储 v5 使用带校验和的多帧 Zstd JSONL；事件格式仍为本产品 v3。v1–v3 JSON 原字节备份，v4 明文代际只读保留；第一次写入才迁移。新指针须通过复读和独立 worker 的事件数、摘要及重建校验。 |
| 检索与游标 | `session-query/session-query-sqlite/src/index.ts:580–792,959–1021`、`session-query/src/cursor.ts`；侧栏取值核对 `api/session-controller/src/list.ts:193–295` | `session-search-index.mjs` 的游标绑定查询、作用域、服务实例和相关记录代际；失效明确报错。`session-query.mjs` 只重新索引变化的来源，冷日志缓存上限 2。侧栏复用同一 FTS 索引及 current 用户/助手消息过滤，不再被旧的 8MB 单记录/32MB 总扫描预算静默遗漏。 |
| 完整导出 | `session-query/session-log-export/src/archive.ts:1–120,325–409`、`markdown.ts:1–130` | `session-export.mjs`，流式 ZIP 包含根逻辑事件、后代会话及引用附件/图片，内容 hash 校验、重复路径冲突拒绝；独占临时文件、fsync、无覆盖发布。取消、删除或附件变化不能留下一个看似完整的导出。侧栏有“导出完整对话”。 |
| 原生供应商与认证 | `llm/llm-pi-ai/src/{models,provider,provider-data}.ts` 全文、`auth.ts:1–125`、`login.ts:1–175`，及同版本 SDK 的 models/auth/Google/Mistral 源码 | 直接复用参考所用 `@earendil-works/pi-ai` 1.3.0 的 42 个供应商目录、模型能力、原生 stream 和认证实现，接通 Gemini、Bedrock、Mistral、Vertex、Copilot、Codex 等原生路线。自定义三种接口仍可用。协议和思考 wire 映射留在适配器；UI 显示供应商、模型及强度。 |
| 技能和运行资源 | `skill/skill-filesystem/src/index.ts:1–225,294–378,464–527`、`skill/skill-office/src/index.ts` 全文及 Office 技能资源；`tool/tool-workspace-dependencies/src/index.ts:84–277` 与文件末尾；`scripts/primary-runtime/prepare.ts:1–231`、锁文件 | 文件系统技能采用有界 Chokidar 缓存和稳定写入后失效；项目/用户技能仍优先。随包提供 7 项 Office 技能、匹配的 LibreOffice Kit 0.1.5 原生引擎和完整依赖、固定 Python 3.12.14 及 13 个包、Node 24.21.0、pnpm 12.16.1。`load_workspace_dependencies` 首次离线准备，返回真实绝对路径和锁定版本；资源缺失/平台不符会报错，不能冒称环境已就绪。 |
| 终端前台与信号 | `subprocess/subprocess-local/src/{process-inspector,windows-inspector}.ts` 全文、`terminal.ts:1–230`；`terminal/terminal-bash/src/session.ts:380–670` | `terminal-inspection.mjs` 移植实际 OS 探针；Linux 读取前台 PGID 和线程 syscall 证据，信号指向真实前台组，拒绝 SIGKILL 顶层 shell。Windows 与参考一样用控制台伪组且精确 stdin 状态为 false，SIGINT 走控制台、SIGTERM 走所属树；不把提示符线索伪装成确定等待。输入 revision 防止晚到探针回写旧状态。 |
| 大文件编辑与原子替换 | `fs/fs-local/src/fsio.ts:1–170,620–785`、`win32.ts` 全文 | `change-blobs.mjs`、`fs-atomic.mjs`、`fs-win32.mjs`：移除 4MB 修改上限；完整前后版本以内容 hash 分文件保存，小索引不重复嵌入正文，审阅分页。独占私有同目录 staging、写前复制 DACL、fsync 和 Windows ReplaceFileW；撤销检查完整当前版本与存储 hash。 |

## 核心结构及边界

- 分页切点为 `{startSeq,endSeq,totalEvents,revision}`，不把 UI 下标当日志 seq。页面从用户/目标轮次起点开始；仅浏览旧记录不获取写租约、不迁移、不修复。
- 历史指针 `{v:5,storage,generation,id}` 指向不可变身份的 `.jsonl.zst`；第一帧仅头记录，后续帧为连续 `{seq,event}` 批。只读结构扫描识别完整帧；断尾尽力保留完整 JSONL 行，只有取得写租约后才修复。完整帧校验失败、未知必要格式、坏 UTF-8、事件序号断裂均拒绝加载，不能回落空历史。工具中断回执以当前 itemId/id 配对并合批，避免旧轮同名调用掩盖未完成调用。
- 每个追加批只做一次持久发布；`appendBatch` 先校验整批才接纳。宿主保留同步耐久边界，未引入后台延迟写盘的“已显示但尚未保存”窗口。迁移 worker 独立验证，但当前宿主发布会等待验证完成，不声称迁移全过程已变成异步后台任务。
- 游标 `{version,instance,scope,fingerprint,generation,offset}` 不允许跨查询/跨范围/重启或相关日志变化后继续。FTS 是上游的字面短语、命中数/文档长度/时间排序，并非 BM25。派生库不是历史事实来源。
- 原生回放继续绑定供应商、端点、API、模型及可见内容摘要；Google thoughtSignature 由同版 SDK 验证和回放，不能自行拼出兼容格式。原生认证采用各供应商自己的授权流程、环境或配置解析；本产品不把服务商私有字段暴露给用户。
- 凭据写入按渠道串行；只有 native keyring 保存确认后才接纳新 grant。取消、刷新失败、磁盘/凭据库失败保留旧值。大 grant 分块保存在 Windows 凭据库，原子 manifest 切换、摘要核验；UI 只转送 AES-GCM 密文，不接触 token，不进聊天历史或普通配置。供应商身份不能在同一渠道 ID 上偷换，避免另一供应商继承已有认证。
- 技能根缓存最多 128；失效、监听错误和关闭有明确处理，未知状态重新扫描。预置 Office 资源可以读取同包 reference，但不能越出包根。依赖 payload 只在本产品管理目录内准备，不修改系统 PATH，不拿系统 Python 冒充随包环境。
- 原子编辑复制的是实际权限 ACL；Windows 自动继承控制位可能由 OS 归一，权限 ACE 保持一致。保存版本损坏不能撤销覆盖当前文件；外部改动不能被旧观察覆盖。大文件编辑仍有完整字符串内存开销，和参考接口相同，不宣称无限内存。

## 保留的宿主差异及理由

1. Tauri/Node、现有项目索引、v3 事件协议和 SQLite OS 写租约属于产品宿主，保留兼容本产品旧对话；不把它们改成上游 Cordis RPC 或直接导入 DSH 会话文件。ZIP 是本产品逻辑导出，不能宣称可直接导入 DSH。
2. 计划、目标、通用子代理、消息组织、环境/记忆与工具等前轮改造保持不变。本轮是此前剩余能力的闭环，不重写已验证的模块。
3. 本地 Windows 使用 PowerShell/WinPTY，Linux 使用 POSIX PTY。核对源码后纠正旧审计：参考项目在 Windows/macOS 也没有 Linux 那种精确 stdin syscall 探针。两端在这些平台均不伪造确定的 stdin_read。
4. Office 原生引擎未修改并保留 MPL-2.0、上游 source 和依赖许可；移植的 MIT 算法/技能保留 DeepSeek 版权。无运行时跨仓源码或 node_modules 引用。
5. 通用 OpenAI OAuth 沿用上游的设备标识限制，不暴露不可工作的登录选项；独立 OpenAI Codex 的上游认证仍按目录提供。服务商账号和厂商端限制不是本地夹具能替代的验证。

## 验证记录

本节在 release UI 验收后补齐最终回执，未执行的项目不标为通过。

- 核心专项 37/37；新增侧栏大于 8MB 冷记录检索专项所在文件 9/9，通过且没有创建 Agent、迁移或修改源文件。
- UI 构建、静态审计、native release 构建及实际打包 sidecar（WS/工作区/工具/PTY/退出）检查通过。
- Windows 系统凭据库用独立虚构 record 实测大 grant、Unicode 分块、拒绝超限后旧值保留、替换和清理，1/1。
- 隔离真实 Linux PTY 实测 stdin read、前台进程组信号和顶层 shell SIGKILL 拒绝；WSL 的 Node16 仅运行纯探针夹具，不用于本产品 Node24 应用验证。
- Office 实际原生 DOCX/PPTX/XLSX→PDF、公式重算 C2=15、PNG 预览均通过，并查看实际预览。DOCX 回执列出缺少 Courier 字体；不能据此声称所有字体完全一致。
- 打包测试发现 optional Koffi 原生包遗漏，已修复依赖闭包复制并重新跑通实际转换；仅 capabilities 成功不算引擎可用。

当前交付聚焦 Windows。未对 macOS/Linux 完整桌面包、所有供应商线上账号/OAuth、物理断电/磁盘故障或长期运行做实测；不能把源码接通和短期验收写成“全平台、全账号、一切情况完全相同”。

## 第四轮验证补充

最终核心专项 **40/40 通过**；稳定索引重启复用、命中不重新读取冷日志和快照恢复所在专项 **11/11 通过**。旧广泛扫描保留完整日志，不以它替代真实 UI：本轮早期扫描 566 项、507 通过、59 失败；用本轮未改动基线树单独展开源码、共享同一套已安装依赖和相同命令重跑，得到 549 项、493 通过、56 失败。两边共有的失败包含旧夹具未关闭写租约、固定事件位置、旧停止/思考/输入等待规则等。

本轮多出的三项分别是：Google HTTP 子测试已通过后，`--test-force-exit` 触发 Node/Windows `UV_HANDLE_CLOSING` 原生断言；高并发/构建期间的大文件读取超时；提示符线索的实际等待落在 timeout 而非 inferred_idle。后两项保留原断言单独重跑 **2/2 通过**，Google 流程在不强制退出的专项中也通过。修正了我们新增的快照测试未释放历史句柄的清理遗漏。不能把以上写成“全量测试已绿”，也不通过修改旧规则或删除失败项刷绿。

**实际 Windows release UI 已确认：**

- 1003 个聊天中，1001 个各有 210 轮/630 条事件；首次只加载所选聊天第 161–210 轮，向前加载显示第 111 轮起点。仅浏览时没有创建历史写租约。
- 真实模型从发布资源实际调用工作区依赖和 office-xlsx 技能；首次离线准备约 13.7 秒，重启后复用。修正工具漏返回解释器版本的问题后，真实模型报告 Python 3.12.14、Node 24.21.0、pnpm 12.16.1，并正确区分宿主 Node 和 authoring Node。
- 供应商目录与 Google 原生模型配置表单实际可用；没有录入虚构凭据到正式渠道，也没有自动操作账号登录界面。
- 通过真实原生保存对话框导出完整 ZIP，解压核验逻辑日志；后代和附件导出的契约另有专项覆盖。
- 正常退出/重启保留对话、模型强度和技能结果；1001 个冷长日志和源旧 v2 JSON 的原始 SHA256 均保持不变，driver 为可校验的 v5 压缩日志。
- 压力验收发现通用 RPC 的 130 秒超时会丢弃仍在建索引的搜索；修正为有明确取消生命周期的搜索/导出请求，断线清理等待项，清空/离开搜索会取消后端。最终发布版实际等待超过 130 秒仍显示正常搜索，清空后索引提交停止；已完成部分可在下次搜索/重启复用。
- 搜索命中返回稳定原始 seq，界面按需定位所属轮次；不为了 100 个结果再解析 100 份完整冷历史。大量全新文本的首次建索引会较慢，懒加载和有界内存不等于首次全量索引没有成本。

本轮明细回执在聚合目录 `.tmp/dsh-parity-20261103-r4/`：`targeted-final.txt`、`restart-index-final.txt`、`full-backend-bounded.txt`、`full-baseline.txt`、`test-comparison.json`、`contention-recheck.txt`、`ui-evidence.json`、`office-runtime-evidence.json`、`keyring-test.txt` 和 `packaged-final-smoke.txt`。最终交付目录为隔离树 `artifacts/dsh-parity-20261103-r4/DecryptHub-win-x64`，使用隔离 appdata；不替换正式程序或正式数据。

最终 UI 补充：完整索引覆盖全部 1003 会话，结果页展示早期消息；从搜索命中实际自动加载到第 1 轮并稳定停留。发现搜索旧跳转直接写 scrollTop 与跟随控制器冲突，已改为统一调用 ChatScroll.jumpToTurn；最终 native release 复验通过。索引建好后再次正常退出/重启，全文检索复用持久来源版本并再次命中、定位第一轮，未重新解析所有未变化的日志。
