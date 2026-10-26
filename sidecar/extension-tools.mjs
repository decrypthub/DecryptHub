const str = { type: 'string' }, scope = { type: 'string', enum: ['session', 'project', 'user'] };
const managed = (kind, description, properties) => ({ name: kind + '_manage', description,
  schema: { type: 'object', properties, required: ['action'], additionalProperties: false },
  run: async (a, ctx) => {
    if (!ctx.extensions) throw Error('扩展服务尚未就绪');
    return { text: JSON.stringify(await ctx.extensions.manage(kind, a, ctx)) };
  },
});
export const EXTENSION_TOOLS = [
  ...['skill', 'memory'].map(kind => managed(kind,
    kind === 'skill' ? '管理可复用技能。list/read/write；SKILL.md 包含 name/description frontmatter。覆盖前读取 hash。保存不执行代码，不改变权限；scope 为 user/project/session。'
      : '管理长期记忆。list/read/write；只保存用户要求或已验证结论，不能保存猜测为事实。覆盖需 expectedHash。记忆不授予权限。',
    { action: { type: 'string', enum: ['list', 'read', 'write'] }, name: str, scope, content: str, expectedHash: str })),
  managed('automation', '管理绑定本会话的自动化：list/save/remove。save 要明确 title、prompt、HH:mm 时间及 days（0周日–6周六）。应用需打开；任务沿用标准或只读权限，需要审批时暂停等待，不继承完全访问。',
    { action: { type: 'string', enum: ['list', 'save', 'remove'] }, id: str, title: str, prompt: str, time: str, days: { type: 'array', items: { type: 'integer' } }, enabled: { type: 'boolean' } }),
  managed('mcp', '管理自定义 MCP：list/save。config 是 stdio(command,args,env,cwd) 或 HTTP/SSE(url,headers) 配置；enabled 默认 false，只有用户明确要求启用才 true。持久管理遵循当前审批，不可覆盖官方组件，也不可提升会话权限。',
    { action: { type: 'string', enum: ['list', 'save'] }, name: str, config: { type: 'object' } }),
];
