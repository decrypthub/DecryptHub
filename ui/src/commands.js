export const COMMANDS = [
  { name: 'goal', label: '持续推进目标', description: '明确目标，持续执行；可暂停、继续，保持现有权限', argument: '目标内容' },
  { name: 'compact', label: '压缩上下文', description: '保留任务、证据、关键结论和最近的对话', argument: '可选：重点保留的内容' },
  { name: 'agent', label: '创建研究子代理', description: '独立上下文，只读分析工作区代码', argument: '自包含的研究任务' },
  { name: 'agents', label: '查看子代理', description: '查看运行状态、结论或取消研究任务' },
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
