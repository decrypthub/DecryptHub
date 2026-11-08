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

/** Dictionary key union. */
export type MemoryKey = keyof typeof en
