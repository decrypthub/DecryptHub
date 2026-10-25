# 可选组件：首版安装与联调

本轮实现本地安装、完整文件校验、原子激活和独立 MCP 进程。GitHub 组件目录、签名发布、图形安装和自动更新尚未交付；设置页明确显示安装状态，不会自动执行远程脚本。

## 安装 WDH

在单独的 WebDecryptHub 工作目录中：

```sh
npm ci --ignore-scripts
npm test
npm run build
```

构建输出目录保存在 WDH 的 `dist/latest-component.txt`。回到 DecryptHub：

```sh
node scripts/install-component.mjs --from <WDH构建输出目录> --allow-local
```

`--allow-local` 表示用户明确接受本地构建代码。这条路径不将 checksum 当作发布者签名。安装器校验平台、API 版本、相对路径、文件类型、大小和全部 SHA-256；校验成功后才切换 active.json，无安装脚本。重启 DecryptHub 生效。

默认使用当前用户应用数据。开发体验时，可将环境变量 `DECRYPTHUB_DATA_DIR` 指定为 DecryptHub 项目内 `.tmp/desktop-appdata/WebDecryptHub` 的绝对路径后再安装；不要改 HOME、USERPROFILE 或 APPDATA 来重定向浏览器的操作系统运行环境。

WDH 不携带浏览器内核。安装后在设置的 WDH 组件页选择系统 Chrome / Edge，或者按 CloakBrowser 的独立二进制条款下载 Cloak。内核、组件和 Harness 使用独立版本。

## 源码联调

```sh
npm run check:wdh -- <独立WDH工作目录>
```

也可在启动开发桌面前设置 `JSRA_DEV=1` 和 `DECRYPTHUB_WDH_DIR=<独立WDH工作目录>`，跳过组件复制。仅 JSRA_DEV=1 时接受此开发路径。UI 验收命令：

```sh
npm run build:ui
npm run audit:ui
npm run check:ui
npm run check:desktop-browser
```

后三项需要 WDH 已安装或上述开发路径可用。原生检查还需要先构建 Windows 桌面程序。测试只启动和关闭自己的进程、使用自己的聊天及浏览器配置，不操作用户现有 Chrome 会话。

## 后续发布约定

先建立平台制品、签名元数据、校验和与兼容性矩阵，再接入 GitHub Release 下载、升级及回滚。不会把任意 GitHub URL 当作可信组件源。IDH / ADH 设备插件由用户按各自项目说明安装；Harness 只连接用户已启用的 MCP / CLI。
