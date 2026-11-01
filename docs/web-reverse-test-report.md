# Web 逆向能力测试报告（2026-11-01）

## 范围与限制

- 测试对象：Desktop 产品同一套 sidecar（`SessionManager` + Agent + 工具 + WDH 浏览器组件 + CloakBrowser 内核），不是另写的模拟器。
- 靶场：本机受控 HTTP 服务，页面加载压缩 JS，`/api/flag` 要求 `ts + nonce + sign`，`sign = FNV-1a32(secret + ":" + ts + ":" + nonce)`；成功返回 `DH_WEBRE_*` FLAG。
- 模型：当前应用设置里的 active provider 没有可用 API Key（keychain 里只有另一个 provider id 的旧条目），因此测试使用公开免费的 OpenAI 兼容端点（`text.pollinations.ai`，实际模型 `gpt-oss-20b`，匿名额度）。所以结果**同时受模型能力影响**，不是纯产品能力分数。
- 内核/组件：使用已安装的 CloakBrowser 内核 + 本地 WDH 源码组件，headless 启动。

## 测试 A：HTTP/JS 层逆向（不限制工具）

任务：打开靶场，分析 `/assets/app.js`，还原签名算法，请求接口拿 FLAG，写 `web-re-report.md`。

结果：**成功，约 3 分 49 秒内完成**（服务器时间戳：49.5s 取到 app.js；102.8s 第一次错误请求；228.8s 成功请求）。

| 指标 | 值 |
|---|---|
| 工具调用 | 7 次（1 次参数错误） |
| 最终 FLAG | `DH_WEBRE_2211ddff` |
| 报告 | `web-re-report.md`，2035 字节 |
| 浏览器调用 | **0 次** |

工具序列：
1. `workspace_run` → 参数错误：模型把 shell 的 `cmd` 传给了 `workspace_run`（错误提示未指出应使用哪个工具）；
2. `workspace_shell` curl `/assets/app.js` → 拿到压缩 JS；
3. `workspace_shell` curl `/api/flag?ts=0&nonce=abc&sign=123` → `expired ts`（模型用错误签名探接口）；
4. `workspace_run` node 打印 `ts/nonce/sign`；
5. `workspace_run` node 打印完整请求 URL；
6. `workspace_shell` curl 正确 URL → `{"ok":true,"flag":"DH_WEBRE_2211ddff"}`；
7. `workspace_write` 写报告。

报告还原正确：FNV-1a 32 位（offset 2166136261、prime 16777619）、secret `DHRE_7f3a`、`h(k+":"+t+":"+n)`、成功请求示例与 FLAG 全部正确。

**结论**：对“读压缩 JS → 识别算法 → 用脚本复现 → 验证接口”的简单 Web 逆向，Agent 能力成立；但它**主动绕开了浏览器**，用 curl/node 完成，产品主打的浏览器抓包/调试链路没有被使用。这在真实站点上会直接失败（Cookie/CSRF/风控/浏览器指纹）。

## 测试 B：强制浏览器路径

任务追加约束：必须用 `browser_open` / `browser_snapshot` / `browser_click` / `browser_requests`，禁止 curl/node 直接请求；靶场也加了 HttpOnly Cookie + 点击按钮才发请求。

结果：**失败，两次复现同一问题**。

| 指标 | 值 |
|---|---|
| 工具调用 | 2 次 |
| 成功 FLAG | 无 |
| 报告 | 无 |
| 第二次调用 | `browser_snapshot<|channel|>commentary` → 工具错误 |

轨迹：
1. `browser_open` → 成功（`当前页面：http://127.0.0.1:.../`，说明浏览器/CDP/内核链路正常）；
2. 模型发出的工具名是 `browser_snapshot<|channel|>commentary`（把模型内部 channel token 拼进了工具名）；
3. Harness 将其当成未知工具，返回“工具未启用或不可用，请先 discover_tools 加载相应工具组”，模型随后停止；
4. 换一轮重跑，同样的第 2 步、同样的错误，可稳定复现。

这不是浏览器能力失败，而是**模型输出工具名的兼容性/清洗问题 + 错误提示误导**。对 OpenAI 兼容后端，工具名可能带 `<|...|>` 特殊 token；产品应做白名单清洗，未知工具应返回“未知工具：xxx（可用工具：…）”而不是让模型去 discover。

## 测试 C：浏览器工具链直接健康检查（不经过模型）

用真实的 WDH 组件 + CloakBrowser 内核直接调用工具：

| 检查项 | 结果 |
|---|---|
| `browser.launch` headless | ✅ 成功，返回内核 Chromium 路径 |
| `browser_snapshot` | ✅ 返回渲染后的 DOM（按钮“获取数据”、JS 执行后的 `text: ok`） |
| `browser_requests` | ✅ 捕获 `/api/ping` 请求与响应状态 |
| `browser.newPage` | ✅ 页面数 1 → 2，active 切到新页 |
| `take_screenshot(filePath=...)` | ❌ `未知 WDH 工具：take_screenshot` |
| 文件落盘 | ❌ 未生成 |

**结论**：浏览器核心能力（启动、快照、抓包、多标签）健康；但 `take_screenshot` 在没有先 `discover_tools` 的情况下直接不可见，与用户反馈“截图不知道产物在哪/没法喂表单”一致；这也解释了为什么模型在真实会话里经常绕开浏览器。

## 综合结论

| 能力 | 结果 |
|---|---|
| 读压缩 JS / 识别常见签名算法 | ✅ 通过（简单 FNV-1a 靶场） |
| 用脚本复现签名并请求接口 | ✅ 通过（7 次工具调用，1 次参数错误后恢复） |
| 浏览器启动 / 快照 / 抓包 / 多标签 | ✅ 通过（直接工具测试） |
| 模型驱动的浏览器逆向闭环 | ⚠️ 未完成：外部模型工具名污染导致第二次调用失败（可复现） |
| 截图产物 / 表单上传 | ❌ 不可用（截图工具未发现；upload 待组件实现） |
| Debugger 暂停自愈 | 未测试（已知审计 P0） |

一句话：**“脚本型 Web 逆向”已具备可用能力；“浏览器型 Web 逆向 + 调试器”还没被打通，而且模型会优先走 shell 绕过浏览器，真实反爬站点会放大这个问题。**

## 证据与复现

- 第一轮输出、工具轨迹与靶场请求日志：本轮会话记录 + `.tmp/web-re-eval/result.json`（最后一轮浏览器测试会覆盖，脚本在 `.tmp/web-re-eval/`）。
- 浏览器直接健康检查脚本：`.tmp/web-re-eval/browser-health.mjs`。
- 靶场与测试脚本：`run.mjs` / `run-browser.mjs`（临时目录，含随机 flag）。
- 复现：`node .tmp/web-re-eval/run.mjs` 与 `node .tmp/web-re-eval/run-browser.mjs`；后者依赖公开免费模型额度。

## 建议下一轮

1. 用你配置的真实模型重跑测试 B（浏览器强制路径）；
2. 给工具名做白名单清洗，未知工具返回可用工具清单；
3. 把 `take_screenshot` 放到 core/browser 组并默认返回落盘路径；
4. 用带 `debugger;`/反调试的靶场测 pause/resume/self-heal；
5. 用真实外部站点前先确认授权范围。
