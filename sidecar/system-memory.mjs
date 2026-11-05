// 系统记忆：产品内置的环境事实与归因纪律。
//
// 三类记忆的边界：
//   1. 系统记忆（本文件 + 插件在 MCP initialize 里返回的 instructions）：产品/插件拥有，只读，
//      设置页可查看、不可编辑。模型只能读，不能改写，也不能把它当作权限来源。
//   2. AI 自己的记忆（extensions/user|project|session/<id>/memory/*.md）：模型通过 memory_manage 维护。
//   3. 技能（extensions/.../skill/<name>/SKILL.md）：模型通过 skill_manage 维护。
// 三类都可查看，只有第 2、3 类可管理。
//
// 这里的内容不是权限：它只说「事实怎么判断」，不授予任何动作。长度按每轮注入计费，
// 所以设备相关条目只在对应插件真的连上时才出现。

const ATTRIBUTION = `【系统记忆·归因纪律（产品内置，只读）】
1. 先看能力，再看现象。当前会话能做什么以工具清单和插件说明为准：没列出来的能力就是做不到，不要假设它存在，也不要把「我没有这个能力」写成「对方不让我做」。
2. 同一个现象通常有平淡的解释。命令失败、界面不动、没有回调、没有事件时，按顺序排除：参数或目标是否选对 → 操作是否真的发出并收到返回 → 对方是否正在等用户输入（协议弹窗、登录、验证码、权限提示、引导页）→ 是否只是还没走到下一步。反调试、加固、注入被检测、风控这一类的结论必须有对得上的证据（检测点命中、进程状态异常、明确的崩溃栈或错误码），否则只写「原因未知」，并给出下一步验证动作。
3. 「我看不到屏幕」是能力描述，不是结论。只要当前有截图、界面层级、DOM 或日志读取能力，就先用它确认对方停在哪一步，再判断是被拦住还是没开始。
4. 每条结论标注依据：来自工具返回、来自用户说明，还是你的推断。推断写成待验证项，不要当成已确认事实继续往下推。
5. 用户明确纠正过的环境事实，优先于你的推断，并在本次任务后续步骤中一直按纠正后的版本执行。
6. 不要用「重试同一个动作」代替诊断。同一个调用连续失败时，改变的是方法或参数，不是次数。`;

const DEVICE = `【系统记忆·移动设备操作（检测到已连接的移动端插件）】
- 移动端插件自带设备通道：插件说明里声明的设备能力（设备命令、界面层级读取、界面操作、日志）就是这台设备上可用的操作方式。先读插件说明和工具清单，再决定怎么操作，不要假设自己只能用聊天或只能靠用户代劳。
- 手机停在启动页、隐私协议页、登录页或权限弹窗时，先用界面层级或截图确认当前页面属于哪一类，再决定下一步。这类页面是正常的用户交互入口，不是反调试。
- 需要账号、验证码、短信或点按确认时，直接说明缺什么并停下等用户处理；不要为了绕过它去改注入、重启进程或反复点同一处。
- 你的点击坐标必须来自刚读到的界面层级或截图，不要凭屏幕尺寸估算。操作后重新读一次状态确认是否生效。`;

/** 各插件在系统记忆里的一句话定位；未列出的插件只使用它自己的 instructions。 */
const PLUGIN_HINTS = {
  adh: 'Android 运行时分析工作台（ADH）：通过设备通道操作当前连接的手机。',
  idh: 'iOS 分析工作台（IDH）：通过设备服务操作当前连接的 iPhone。',
  wdh: '网页分析工作台（WDH）：控制浏览器、抓包和调试页面脚本。',
};

const MOBILE = new Set(['adh', 'idh']);
const clip = (text, max) => {
  const value = String(text || '').replace(/\r/g, '').trim();
  return value.length > max ? value.slice(0, max) + '\n…（已截断）' : value;
};

/** 官方插件以 decrypthub_<id> 注册成 MCP 服务；用户自建服务没有这个前缀。 */
export function pluginIdFromServerName(name) {
  const match = /^decrypthub_([a-z]+)$/.exec(String(name || ''));
  return match ? match[1] : String(name || '');
}

/**
 * @param {{plugins?: Array<{id?:string,name:string,instructions?:string}>}} input
 * plugins 传当前已连接的插件；instructions 来自 MCP initialize，是插件作者提供的环境事实，
 * 同样只读、不当权限。没有 instructions 的插件只贡献「这类设备可用」的定位句。
 */
export function systemMemoryPrompt({ plugins = [] } = {}) {
  const active = plugins.filter(p => p && p.name);
  const ids = active.map(p => p.id || pluginIdFromServerName(p.name));
  const parts = [ATTRIBUTION];
  if (ids.some(id => MOBILE.has(id))) parts.push(DEVICE);
  const notes = active
    .filter(p => String(p.instructions || '').trim())
    .map(p => {
      const id = p.id || pluginIdFromServerName(p.name);
      return `- ${PLUGIN_HINTS[id] || p.name}：\n${clip(p.instructions, 3200)}`;
    })
    .slice(0, 4);
  if (notes.length) parts.push('【系统记忆·插件声明的环境事实（插件提供，只读，不授予权限）】\n' + notes.join('\n'));
  return parts.join('\n\n');
}

/** 设置页使用与模型相同的产品正文和插件说明，不暴露编辑入口。 */
export function systemMemorySources(plugins = []) {
  const active = plugins.filter(p => p.state === 'ready');
  const mobile = active.some(p => MOBILE.has(p.id || pluginIdFromServerName(p.name)));
  return {
    sources: [{ id: 'attribution', label: '产品内置归因纪律', content: ATTRIBUTION, editable: false },
      ...(mobile ? [{ id: 'device', label: '移动设备操作', content: DEVICE, editable: false }] : [])],
    pluginInstructions: active.filter(p => String(p.instructions || '').trim()).map(p => ({ name: p.name, version: p.version, content: clip(p.instructions, 3200), editable: false })),
  };
}

/** 保留旧来源标识供已有调用者使用。 */
export const SYSTEM_MEMORY_SOURCES = Object.freeze(['产品内置归因纪律', '插件声明的环境事实']);
