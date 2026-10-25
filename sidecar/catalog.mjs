import { WORKSPACE_TOOLS } from './workspace.mjs';
import { BROWSER_TOOLS } from './browsertools.mjs';
import { TODO_TOOLS } from './todos.mjs';
import { AGENT_TOOLS } from './agenttools.mjs';
import { HARNESS_TOOLS } from './harnesstools.mjs';

// One product registry shared by the runtime and the settings UI.
// Legacy specialist modules remain importable for old artifacts, not model tools.
export const DEFAULT_TOOLS = [{name: 'component_list', description: '查看可选平台组件的安装状态。网页分析需要 WDH，核心文件任务无需组件。', schema:{type:'object',properties:{}}, run:async(_a,ctx)=>({text:JSON.stringify(ctx.components?.info()||{installed:false})})}, ...WORKSPACE_TOOLS, ...TODO_TOOLS, ...AGENT_TOOLS, ...HARNESS_TOOLS, ...BROWSER_TOOLS];
