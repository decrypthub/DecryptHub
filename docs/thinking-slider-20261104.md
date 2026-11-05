# 思考强度滑杆 — 2026-11-04

用户提供 ChatGPT 形式的参考图，明确不要快速模式和刷新/复位按钮。现在浮层居中显示当前英文档位，下方为模型入口，再下方为带圆点刻度、白色拖动钮的胶囊滑杆。删除旧的全部档位文字行和复位动作，保留产品强调色。模型目录入口和会话级选择协议沿用原有实现。

## 实现与参考范围

- 修改 `ui/src/thinking-picker.jsx` 和 `ui/src/app.css`。使用 Radix Slider Primitive 的指针、触摸、键盘和离散档位处理，不自行实现拖动状态机。
- `@radix-ui/react-slider@1.6.1` 原本已由 Themes 间接安装，本轮提升为直接声明，锁文件复用原有包记录，没有引入另一套组件库。
- 实读参考 `../deepseek-harness/packages/client/ui-model-selection/src/client/ModelSelect.tsx:130–180,255–290`：模型 reasoning 元数据决定 efforts，effectiveEffort 使用选择或模型默认，未知值和无声明模型单独处理，钻入模型列表有焦点/返回边界。该文件的列表式外观与用户本次参考不同，视觉按用户指示采用滑杆；未声称移植整个 ModelSelect。
- 关键数据仍为 `levels: string[]`、`value/defaultLevel: string`，经 `normalizeThinkingLevels` 过滤、去重和排序。Slider 使用声明数组的索引，提交时映射回原档位 ID，不向 Host 发送滑杆数字。

边界处理：

1. 无声明时不显示可拖动控件；仅一档时禁用滑杆。支持哪些档位由模型声明决定，不能拖出未声明值。
2. 拖动仅更新本地预览，松开后提交最终档位；方向键、Home/End 由 Radix 处理。保存失败后清理预览，回到 Host 的受控值。
3. 模型或声明变化清理旧预览；更晚的旧提交收尾不清理同一个控件的新拖动预览。关闭浮层后仍按原有规则恢复默认面板与搜索词。
4. 英文名称通过 `aria-valuetext` 提供给读屏，滑杆是单个焦点；装饰刻度不变成额外按钮，不出现协议参数或快速/复位动作。

## 验证与制品

本机证据目录 `.tmp/thinking-slider-20261104/`，不入 Git。

- UI 81/81 通过；UI build、audit 和 Cargo release --locked 通过。
- 后端完整扫描 583 项：528 通过、43 失败、12 跳过。43 个失败名称与上一轮原始基线完全一致，无新增名称，见 `test-comparison.json`；没有宣称全绿。
- 独立数据、本机 HTTP 模型夹具、Ego TaskSpace 11 实际操作：Home → Off、ArrowRight → Minimal、End → Max；真实指针从 Max 拖至 Medium，刷新后恢复 Medium；模型入口可进入目录并返回。截图 `slider-medium.png`、`slider-preview.png` 已查看，未写固定尺寸/像素视觉断言。
- 最终版本再验证拖动中的浮层为 Max、落盘仍为 medium，松开才提交；连续 Home 和三次 ArrowRight 最终为 Medium。另用相同发布二进制、更换 bundle ID 和独立数据的 Mac 原生窗口实际打开浮层，确认居中 Medium、模型入口和白色拖动钮正常；原生 AX 识别为 slider，值 3，Details 为 Medium。没有配置或调用真实模型。
- 本轮没有运行旧 `scripts/check-thinking-ui.mjs` 作为证据：其分段按钮、中文标签和全局 activeThinking 断言属于旧实现；实际验证使用当前会话选择与可见滑杆。其历史检查不能代替本轮记录。
- 新制品 `.tmp/thinking-slider-20261104/DecryptHub 思考滑杆测试.app`，固定嵌入本轮 UI，沿用上一版未改动的包内 sidecar，签名和文件哈希核对通过。外部清单为同目录 `artifact-manifest.json`。

当前运行中的交互修正测试版未被覆盖或重启。新包仍沿用 `.tmp/macos-dev/WebDecryptHub` 测试数据目录，先退出旧测试窗口再启动。浏览器行为及本轮原生浮层已经分别观察；原生隔离窗口已退出，Ego TaskSpace 已结束，隔离预览服务关闭。Windows 尚未复验；Ego Lite 提示有更新，本轮未升级。
