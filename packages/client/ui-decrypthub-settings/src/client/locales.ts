/** Product memory settings copy. */

/** English dictionary. */
export const en = {
  nav: 'Memory',
  title: 'Memory',
  intro: 'Facts the agent keeps across sessions. Entries are injected into the system prompt and can also be edited by the agent itself.',
  empty: 'No stored memories yet.',
  add: 'Add memory',
  remove: 'Remove',
  placeholder: 'One sentence worth remembering',
  scopeUser: 'All projects',
  scopeProject: 'This project',
  failed: 'Could not read memory settings.',
  pending: 'Loading memory…',
}

/** Chinese dictionary. */
export const zh: typeof en = {
  nav: '记忆',
  title: '记忆',
  intro: '智能体跨会话保留的事实。条目会注入系统提示词，智能体自己也可以维护。',
  empty: '还没有记忆条目。',
  add: '添加记忆',
  remove: '删除',
  placeholder: '一句话，值得记住的事实',
  scopeUser: '所有项目',
  scopeProject: '当前项目',
  failed: '无法读取记忆设置。',
  pending: '正在加载记忆…',
}

/** English dictionary for the role section. */
export const personaEn = {
  nav: 'Role',
  title: 'Role definition',
  intro: 'Text injected at the top of every request as the product persona. An empty value removes it.',
  placeholder: 'Describe the role the agent should take.',
  save: 'Save role',
  revert: 'Revert',
  failed: 'Could not read the role settings.',
  pending: 'Loading role…',
}

/** Chinese dictionary for the role section. */
export const personaZh: typeof personaEn = {
  nav: '角色',
  title: '角色定义',
  intro: '作为产品人设注入每次请求开头的文本。留空则移除。',
  placeholder: '描述智能体应扮演的角色。',
  save: '保存角色',
  revert: '撤销',
  failed: '无法读取角色设置。',
  pending: '正在加载角色…',
}

/** Role dictionary key union. */
export type PersonaKey = keyof typeof personaEn

/** Dictionary key union. */
export type MemoryKey = keyof typeof en
