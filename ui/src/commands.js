export const COMMANDS = [
  { name: 'goal', label: '持续推进目标', description: '明确目标，持续执行；可暂停、继续，保持现有权限', argument: '目标内容' },
  { name: 'compact', label: '压缩上下文', description: '保留任务、证据、关键结论和最近的对话', argument: '可选：重点保留的内容' },
  { name: 'agent', label: '创建研究子代理', description: '独立上下文，只读分析工作区代码', argument: '自包含的研究任务' },
  { name: 'agents', label: '查看子代理', description: '查看运行状态、结论或取消研究任务' },
  { name: 'skill', label: '创建或使用技能', description: '保存可复用工作流，或使用已保存的技能', argument: '技能用途或名称' },
  { name: 'skills', label: '查看技能', description: '浏览当前会话、项目和用户的技能' },
  { name: 'memory', label: '创建记忆', description: '保存已验证的结论或长期偏好', argument: '要记住的内容' },
  { name: 'memories', label: '查看记忆', description: '读取当前范围中保存的记忆' },
  { name: 'automation', label: '创建自动化任务', description: '设置定时执行的任务，或填写要求让 AI 配置', argument: '可选：任务和执行时间' },
  { name: 'mcp', label: '配置 MCP', description: '打开插件配置，或描述要接入的 MCP 服务', argument: '可选：服务配置要求' },
  { name: 'init', label: '建立项目说明', description: '分析主目录并创建 AGENTS.md' },
  { name: 'status', label: '查看当前状态', description: '工作区、权限、浏览器和当前目标' },
  { name: 'stop', label: '停止当前任务', description: '停止主代理与研究子代理，并暂停目标' },
  { name: 'new', label: '新建对话', description: '开始一个新的独立对话' },
  { name: 'help', label: '显示命令', description: '查看所有可用命令' },
];
export function parseCommand(text) {
  const match = String(text).match(/^\/([a-z-]+)(?:\s+([\s\S]*))?$/i);
  if (!match) return null;
  return { name: match[1].toLowerCase(), argument: (match[2] || '').trim(), known: COMMANDS.some(c => c.name === match[1].toLowerCase()) };
}
export function commandMatches(text) { return /^\/[a-z-]*$/i.test(text) ? COMMANDS.filter(c => c.name.startsWith(text.slice(1).toLowerCase())) : []; }

export function extensionRequest(name, argument) {
  const instructions = {
    skill: '请使用 skill_manage 创建可复用技能，或读取并使用已有同名技能。保存时使用有效 slug 和带 name/description frontmatter 的 SKILL.md；先查看已有条目，不能无依据覆盖。只有工具确认写入成功才报告已保存。用户要求：',
    memory: '请使用 memory_manage 保存下面的长期记忆，只记录明确要求或已验证事实。先检查同名记忆，覆盖前读取最新 hash。不要把敏感凭据或未经验证的推断写入记忆。用户要求：',
    automation: '请使用 automation_manage 配置绑定当前会话的自动化。需要明确任务内容、HH:mm 执行时间和星期；缺少必要信息先 ask_user。不得改变权限，只有保存工具成功才报告已创建。用户要求：',
    mcp: '请使用 mcp_manage 配置自定义 MCP。缺少命令、参数或地址时先询问。默认保存为停用，仅用户明确要求启用时设置 enabled=true；不能覆盖官方组件或提升会话权限。用户要求：',
    init: '请阅读主工作目录，创建适合本项目的 AGENTS.md，记录实际架构、常用检查和约定。已有文件先读取，保留用户要求，使用文件工具保存。',
  };
  return instructions[name] ? instructions[name] + (argument || '') : null;
}
