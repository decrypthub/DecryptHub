import { WORKSPACE_TOOLS } from './workspace.mjs';
import { BROWSER_TOOLS } from './browsertools.mjs';
import { TODO_TOOLS } from './todos.mjs';
import { AGENT_TOOLS } from './agenttools.mjs';
import { HARNESS_TOOLS } from './harnesstools.mjs';
import { EXTENSION_TOOLS } from './extension-tools.mjs';
import { REPLY_TOOLS } from './reply-tools.mjs';
import { PLAN_TOOLS } from './plan-mode.mjs';
import { SKILL_TOOLS } from './skill-files.mjs';
import { GOAL_TOOLS } from './goal-tools.mjs';
import { PATCH_TOOLS } from './workspace-patch.mjs';
import { PERSISTENT_SHELL_TOOLS } from './persistent-shell.mjs';
import { SESSION_QUERY_TOOLS } from './session-query-tools.mjs';
import { WORKSPACE_DEPENDENCY_TOOLS } from './workspace-dependencies.mjs';

// One product registry shared by the runtime and the settings UI.
// Legacy specialist modules remain importable for old artifacts, not model tools.
export const DEFAULT_TOOLS = [{name: 'component_list', description: '查看可选平台组件的安装状态。网页分析需要 WDH，核心文件任务无需组件。', schema:{type:'object',properties:{}}, run:async(_a,ctx)=>{
  // status() 里的 needs-runtime 取决于 this.python，而它由异步的 runtime() 填充（初始为 null）。
  // 不先 await 就调 status()，所有 Python 插件会恒定误报 needs-runtime —— 这是「组件装好了却用不了」的根因。
  if (ctx.plugins) { try { await ctx.plugins.runtime(); } catch {} }
  const components = ctx.plugins
    ? ctx.plugins.status().official.map(({id,installed,enabled,version,state,latest,runtimeInfo}) => ({id,installed,enabled,version,state,availableVersion:latest?.version||null,runtimeInfo}))
    : ['wdh','idh','adh'].map(id=>ctx.components?.info(id)||{id,installed:false});
  return {text:JSON.stringify({components})};
}}, ...WORKSPACE_TOOLS, ...WORKSPACE_DEPENDENCY_TOOLS, ...PERSISTENT_SHELL_TOOLS, ...PATCH_TOOLS, ...TODO_TOOLS, ...AGENT_TOOLS, ...PLAN_TOOLS, ...SKILL_TOOLS, ...GOAL_TOOLS, ...SESSION_QUERY_TOOLS, ...HARNESS_TOOLS.map(t => t.name === 'goal_update' ? { ...t, group: 'legacy' } : t), ...EXTENSION_TOOLS, ...REPLY_TOOLS, ...BROWSER_TOOLS];
