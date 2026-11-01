# 社区账号与桌面登录

2026-10-29。参考 DeepSeek Harness `f3803c96974ad4a94195fb97e5c637e9c2a3afe3` 的 `2026-09-14-deepseek-account-login` 决定与 `ui-settings-account`：浏览器完成登录和授权，原生宿主保存凭据，UI 仅观察安全账号快照；取消与退出使晚到结果失效。

## 协议与归属

桌面原生账号模块生成 state 和 PKCE S256，绑定 `127.0.0.1:0` 的临时监听器。系统浏览器打开社区 `/desktop/authorize`。社区复用已有 Rekit/HttpOnly Cookie 登录，在用户明确确认后，向 `/auth/desktop/authorize` 提交请求；服务端只接受配置社区同源的 JSON POST。

回调仅允许 `http://127.0.0.1:<非特权端口>/auth/callback`，不允许额外 query、fragment、userinfo、域名或任意路径。临时授权码有效期 90 秒，数据库只存 SHA-256；兑换绑定完整 redirect_uri 和 PKCE，并在事务中一次性消费。桌面验证 state 后原生兑换，凭据成功保存后才发布已登录。

社区签发独立 30 天桌面会话，数据库只存 token 哈希。权限仅限 `/auth/desktop/me` 和 `/auth/desktop/logout`；不接入通用 Cookie、发文、管理员、模型或支付认证，也不返回 Rekit token。未实现聊天同步或云端模型额度。

原生模块是唯一凭据所有者，系统凭据库存储带来源、到期时间和安全资料的记录；不经过 React、localStorage、sidecar、项目文件或模型工具。正式来源固定为 `https://decrypthub.cn`，debug 构建可用本机 loopback 来源联调，不能从网页参数更换凭据接收方。HTTP 客户端拒绝重定向。

账号头像单独通过原生模块读取：只接受 HTTPS 443、公开 DNS 地址并固定已校验的解析结果，不携带账号 token、不走代理、不跟随重定向。图片限制 512 KiB 和 PNG/JPEG/WebP/GIF 格式；仅把 data URI 返回 UI，保持现有桌面 CSP 不变。失败或过大的头像显示昵称首字，不影响登录；退出/换号使晚到头像失效。

本地取消立即撤销当前尝试；过期或迟到结果不能覆盖后续账号。退出先删除本地凭据，再尽力撤销远端旧 token，网络失败不会恢复登录。401/403 清除已失效登录，暂时网络失败保留已有身份并展示错误。重启从凭据库恢复，刷新资料不阻塞聊天。

## 部署与验收

社区 API 的 Prisma schema 及迁移新增授权码和桌面会话表。迁移脚本只落盘，不由桌面执行，未上线接口不能伪报登录成功。前后端需配套部署且 APP_URL 正确；本地无生产凭据，不自动迁移或部署。

安全测试需覆盖错误回调、跨来源确认、错误 PKCE、过期/重放授权码、取消后晚到、退出和凭据写入失败。Windows/Linux 的真实系统浏览器返回仍需在相应系统验证。

账号桥接命令必须同时登记在 `main.rs` handler 和 `permissions/app.toml`；真实 Tauri UI 的权限检查不能由 Rust 函数单测代替。`sidecar/test/account-errors.test.mjs` 核对七项账号命令的桥接、handler、权限和主窗口能力，并验证原生字符串错误能够显示。2026-10-29 已在真实 Mac 验证系统浏览器启动、等待状态、取消和回调端口释放；线上社区授权页当前为 404，完整生产登录待社区部署。
