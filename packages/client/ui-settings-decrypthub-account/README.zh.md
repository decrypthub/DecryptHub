---
description: "原生 DecryptHub 社区登录与账号设置。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-decrypthub-account

[English](README.md) | 中文

## 概述

此产品插件通过 DSH 设置插槽提供社区账号页面和侧栏入口。Electron 管理浏览器授权与加密持久化；客户端只接收显示身份、积分、经验和分类错误。社区登录不授权模型推理，API 密钥和供应商选择仍由 DSH 模型设置管理。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

DecryptHub Web 组合挂载此插件。客户端仅在原生社区账号桥接可用时显示对应页面；普通浏览器客户端保留原有设置入口。设置 → 账号提供浏览器登录、取消、资料刷新、退出和社区链接，侧栏菜单提供设置与账号操作。积分与经验分别显示，未知余额显示为 `—`。

<a id="understand-the-implementation"></a>
## 理解实现

[`apps/desktop/src/community-account.ts`](../../../apps/desktop/src/community-account.ts) 中的原生实现将临时回环回调绑定到 PKCE S256 和随机 state。重复或无效的回调参数被拒绝，且不会消费当前尝试。取消、超时、卸载或账号变化会阻止晚到结果提交。加密持久化成功后才发布已登录状态。持久化失败或兑换取消时，对已收到但未提交的凭据尽力执行远端撤销。

Electron safeStorage 加密应用独立保存的凭据文件。加密不可用或 Linux 使用明文后端时明确报告失败。主进程命令验证当前应用的顶层 frame。账号凭据不进入渲染层、Host、模型工具、API 密钥存储或项目文件。打包后的签发方固定为 `https://decrypthub.cn`；未打包版本允许显式选择经过校验的开发来源。请求拒绝重定向，限制时间和响应大小。

重启恢复本地仍有效的凭据。刷新时的暂时网络失败保留缓存身份，被服务端拒绝的凭据会被删除。本地退出仅在凭据删除成功后完成，随后尝试远端撤销，网络失败不恢复本地凭据。原生修订号单调递增，迟到的 IPC 读取不会覆盖更新状态。卸载客户端插件会移除原生订阅和设置插槽贡献。

<a id="model-experience"></a>
## 模型体验

无。此包不注册工具、模型供应商或提示内容。

#### KV 缓存影响

无。账号显示不进入模型请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 生产浏览器授权依赖社区桌面接口部署，本机协议测试不能证明生产可用。旧 Tauri 凭据尚未导入。头像使用本地首字，不请求远端图片。社区桌面会话协议不提供模型额度、支付或账号推理。原生流程仍需在 Windows 和 Linux 验收。

<a id="dev-note"></a>
### 开发备注

无。
