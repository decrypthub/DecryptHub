> 2026-11-05 更新：DSH 产品主干已生成并启动独立 macOS 预览包。新仓库为 `../DecryptHub-DSH`；产品状态与限制见其 `DECRYPTHUB.zh.md`。旧会话和模型凭据仍留在本应用，尚未导入；本仓 UI 不再继续扩展。

# DSH 主干迁移 — 2026-11-04

用户已选择改用 DSH 主干，保留完整上游交互，将 WDH、ADH、IDH 接入插件层。新的实现位置为 `../DecryptHub-DSH`，分支 `decrypthub/dsh-product-20261104`，起点 `8bd073392eef6f54e921a093b95076248eb08cbb`。`../deepseek-harness` 继续只读，当前 Tauri 仓库和数据保留。未提交、推送、发布或改写现有历史。

## 当前仓库止损修复

- 输入法通过原生 compositionstart/end、isComposing、229 和组合结束后 10ms 的保护判断；主输入、子代理、队列编辑、回答弹窗、地址栏、搜索和旧登录输入共享此逻辑。
- 删除窗口级 Cmd/Ctrl+Enter 发送入口，避免绕过输入法/弹层或重复提交。提交由当前输入控件处理，按住 Enter 不连续发送。
- 模型行保留独立操作列；能力另起一行，思考显示档位数量和默认值，完整声明仍可查看/编辑，不再挤掉按钮。
- “查看当前文件”使用统一 Button 控件，打开当前文件的实际路径已验证。
- 自动化仍是旧简化实现。本轮没有将其重画成另一个近似表单，也没有宣称已完整对齐；该能力随 DSH 主干整体继承。

UI 测试 85/85、UI build/audit、Cargo release、签名通过。后端 583 项中 528 通过、43 失败、12 跳过，保留原失败基线。浏览器复验中组合确认、结束后的 Enter、229+修饰键保持草稿且模型请求数 4→4；随后一次独立 Cmd+Enter 只发送一次。Mac 原生隔离 release 中，拼音预编辑 `ni` 首次 Enter 确认后保留在输入框，第二次独立 Enter 才生成一条用户消息。未调用真实模型；隔离凭据 `prov.ime-fixture` 已清理，原生验证窗口和 Ego TaskSpace 12 已结束。

固定制品 `.tmp/ui-foundations-20261104/DecryptHub 基础交互修复测试.app` 保留作过渡和回退，不是完整 DSH 迁移版本。现有用户测试窗口没有被替换。证据、构建日志位于同名 `.tmp` 目录，不入 Git。

## 参考依据与迁移边界

实读参考路径及范围：`ui-conversation/src/client/input/editor/keymap.ts:1–55,175–218,237–280`；`ui-settings-models/src/client/ModelRow.tsx:1–140` 内的编辑与独立操作布局；`ui-schedule/src/client/TaskManagerPage.tsx:1–155,188–374`、`TaskDetail.tsx:1–100,300–326,385–415`、`editor-store.ts:1–41`；`mcp/mcp-client/src/index.ts:1–95`、`types.ts:1–82`。前述 UI 路径均位于参考 `packages/client/` 下。

DSH 任务管理使用跨会话目录、状态筛选、搜索、详情规则/记录、异步保存/删除和保留草稿；当前 TaskStore 只有固定时间与星期、绑定现有会话的简化数据，两者不能靠 CSS 等价替换。

官方 [MIT 许可证](https://github.com/deepseek-ai/deepseek-harness/blob/master/LICENSE) 允许修改和分发，产品保留版权/许可和依赖声明；品牌遵循 [使用规范](https://github.com/deepseek-ai/deepseek-harness/blob/master/BRAND_GUIDELINES.md)，不冒充官方。上游仍是 developer preview，迁移固定提交并保留上游测试，不承诺免验收。

迁移不直接复用旧历史写目录或改写旧凭据。需分别验证完整 DSH 输入/任务交互、WDH 的每会话工作目录及界面、ADH/IDH MCP 发现与连接、数据导入和独立打包，再认定可发布。
