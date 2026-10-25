# DecryptHub / WebDecryptHub 拆分边界

状态：2026-10-25，API 1，插件入口与官方 Release 下载安装已接入。本文件优先于拆分前文档中关于 BrowserManager 在核心内的描述。

## 所有者

| 仓库 | 负责 | 不持有 |
|---|---|---|
| DecryptHub | 模型、会话/Run、工作区、文件/代码执行、审批、附件、子代理/目标、MCP 管理、桌面显示 | Patchright、WDH 调试引擎、内核下载实现 |
| WebDecryptHub | 浏览器/Profile/CDP、请求与响应体、调试、指纹观测、内核下载、MCP 服务 | 模型密钥、会话历史、审批决策、Rust 窗口布局 |

每个聊天按需启动一个 WDH MCP stdio 进程，UI 和 Agent 共用同一连接与当前目标。WDH 内部 debugger 子进程也由 WDH 负责关闭。核心通过薄适配层调用；没有通过源码相对路径或共享 node_modules 直接引入 WDH。

## 协议

`component.json` 指明 id、版本、API、平台、架构、entrypoint 与文件 SHA-256。启动先 hello 核对 API；不兼容时拒绝加载。浏览工具描述是 API 1 的核心契约，WDH 实际验证参数。Debugger 通过 discover_tools 返回当前真实 schema；后续工具变更必须升级协议或保持兼容。

标准 MCP tools/list 和 tools/call 对其他客户端独立可用。仅 `--desktop` 才启用未公开枚举的 `wdh_control`，用于可信宿主的启动、内核设置、显示和抓包 UI；它不注册给模型，也不是鉴权或沙箱。父进程持有 stdio 即拥有该进程的控制权。

状态、请求摘要和画面使用 `notifications/wdh/event`。画面帧不进入模型上下文。详情/HAR 由 WDH 读取自己的响应体，核心不从远端传来的路径直接取文件。工具调用携带宿主观察到的页面 id/URL，WDH 拒绝过期目标；这能发现切页，不构成对敌对网页所有竞态的完整防护。

## 生命周期与权限

核心审批发生在发出 MCP 调用前；WDH 的 root 是文件输出边界，不是 OS 隔离。标准 MCP 客户端应自行审批该服务的能力。页面内容不增加权限。WDH 环境排除模型凭据，保留浏览器所需的真实操作系统目录。

关闭会话取消启动并关闭所属 WDH/浏览器；切工作区先关闭组件，再以新 root 重启，避免调试器继续写旧目录。BrowserSurface 继续串行控制原生显示和回退，拆分不改变窗口后端；原生 DPI、输入法和多屏仍需发布前专项验收。

## 安装和兼容

先校验本地组件全部文件，再原子写激活指针；启动复查 entrypoint。失败不替换已有激活版本。当前不提供对恶意本机程序持续篡改的沙箱保证；远程安装使用固定官方仓库、GitHub API digest、来源/版本校验及完整文件校验，不声称有独立发布者签名。详见 plugins.md。

保留旧 app id/keyring/默认数据目录，避免改名导致历史丢失。原仓库完整保留；新 WDH 分支保留 Git 历史。DecryptHub 使用新仓库，以清晰源码快照开始。两边独立版本，组件 API 是兼容边界。
