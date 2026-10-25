// 工具风险与会话模式。确认发生在应用界面，不看模型自己填的 confirm。
// 只读/标准/宿主机权限；授权来自宿主，执行隔离由 Executor 实际探测。
export const MODES = ['read-only', 'standard', 'full-access'];
export const LARGE_OVERWRITE = 8192;
export const normalizeReview = value => value === 'auto' ? 'auto' : 'manual';
// Deliberately narrow host rules; no model-supplied risk score grants access.
export function autoReview(req) {
  if (req.isolated === true && req.trustedPurpose === 'dependency-install' && req.network?.length && req.network.every(h => h === 'registry.npmjs.org')) {
    return { allow: true, rule: 'isolated-npm-registry', reason: '隔离工作区内安装依赖，禁用安装脚本，仅访问官方 npm registry' };
  }
  return { allow: false, reason: req.isolated === false ? '未隔离执行必须由用户批准' : '此操作需要用户确认' };
}

/** 旧版本落盘的 'safe' / 'autonomous' / 'plan' 迁移到新模式名 */
export function normalizeMode(mode) {
  if (mode === 'read-only' || mode === 'full-access') return mode;
  return 'standard'; // Old danger/autonomous values do not silently grant host access.
}

const READ = new Set([
  'component_list', 'browser_open', 'browser_tabs', 'browser_select', 'browser_snapshot',
  'browser_requests', 'browser_request_detail', 'browser_capture',
  'context_ref_read',
  'agent_spawn', 'agent_wait', 'agent_list', 'agent_cancel', 'goal_update',
  'workspace_list', 'workspace_read', 'workspace_grep', 'workspace_job_output',
  'detect_crypto', 'diff_requests', 'find_signature_params',
  'grep_file', 'read_file_slice', 'list_project_files',
  'net_list', 'net_get', 'net_search', 'net_load_har', 'get_cookies',
  'anti_debug_status', 'inject_status', 'fingerprint_report', 'get_hook_records',
  'deobfuscate_code', 'ast_deobfuscate', 'vmp_trace_detect', 'vmp_trace_status',
  'list_pages', 'select_page', 'select_frame', 'list_console_messages',
  'list_network_requests', 'list_scripts', 'get_script_source', 'search_in_sources',
  'list_breakpoints', 'get_request_initiator', 'get_paused_info', 'take_screenshot',
  'get_websocket_messages', 'todo_write', 'ask_user',
]);

const WRITE = new Set([
  'workspace_write', 'workspace_edit',
  'notes_write', 'generate_report', 'export_code',
  'net_save_body', 'net_export_har', 'save_script_source',
  'env_from_fingerprint', 'capture_page_env', 'webpack_extract',
  'vmp_trace_dump', 'vmp_trace_diff', // 总会落盘一份 JSON
  'compact_context', // 追加检查点并写 .agent-history.json / .ctx
]);

const DESTRUCTIVE = new Set([
  'reset_session', 'restart_browser_fresh', 'clear_network_requests', 'clear_site_data',
]);

// 会执行代码的工具（宿主进程或页面内）。风险等级仍要分，界面会据此把危险类标红。
// 「要不要弹确认」是另一个判断：只有碰得到宿主进程/文件的几个才进 approvalCategory。
const EXEC = new Set([
  'browser_click', 'browser_fill', 'browser_press',
  'evaluate_script', 'set_breakpoint_on_text', 'break_on_xhr', 'remove_breakpoint', 'pause_or_resume', 'step',
  'workspace_shell', 'workspace_run', 'workspace_npm', 'workspace_job_kill', 'run_node',
  // 以下都只在页面/沙箱里执行，碰不到宿主进程与文件，因此不需要确认
  'page_call', 'webpack_expose', 'hook_signer', 'inject_rearm',
  'anti_debug_enable', 'anti_debug_disable', 'fingerprint_install',
  'vmp_trace_install', 'vmp_trace_instrument', 'vmp_trace_fetch_hook', 'vmp_log_breakpoint',
  'env_detect_missing', 'env_iterate',
]);

// 所有本地工具都必须落在这四张表里，否则就是一个「没人想过风险」的新工具。
// test/policy.test.mjs 会拿 LOCAL_TOOLS 逐个比对，防止新增工具时漏登记。
export const CLASSIFIED = new Set([...READ, ...WRITE, ...DESTRUCTIVE, ...EXEC]);

export const HOST_EXEC = new Set(['workspace_shell', 'workspace_run', 'workspace_npm', 'run_node', 'export_code', 'ast_deobfuscate', 'deobfuscate_code', 'env_detect_missing', 'env_iterate']);
export const WORKER_TOOLS = new Set(['ast_deobfuscate', 'deobfuscate_code', 'env_detect_missing', 'env_iterate']);

const CONFIRM_INJECT = new Set(['reset_session', 'restart_browser_fresh', 'evaluate_script', 'clear_site_data', 'clear_network_requests', 'remove_breakpoint']);

export function toolRisk(name, args = {}) {
  if (args.outputFile || (args.filePath && name !== 'workspace_read')) return 'write';
  if (HOST_EXEC.has(name)) return 'exec';
  if (name === 'workspace_job_kill' || name === 'discover_tools') return 'read';
  if (name === 'todo_write' || name === 'workspace_job_output' || name === 'context_ref_read') return 'read';
  if (DESTRUCTIVE.has(name)) return 'destructive';
  if (EXEC.has(name)) return 'exec';
  if (WRITE.has(name)) return 'write';
  if (READ.has(name)) {
    if (args.outputFile && (name === 'deobfuscate_code' || name === 'ast_deobfuscate' || name === 'vmp_trace_detect' || name === 'fingerprint_report')) return 'write';
    if (name === 'take_screenshot' && args.filePath) return 'write';
    if (name === 'inject_status' && args.rearm) return 'exec';
    if (name === 'get_hook_records' && args.clear) return 'write';
    if (name === 'fingerprint_report' && args.save) return 'write';
    return 'read';
  }
  return 'exec';
}

export function isDifferentHost(target, current) {
  let a = '', b = '';
  try { a = new URL(String(target)).host.toLowerCase(); } catch { return false; }
  try { b = new URL(String(current)).host.toLowerCase(); } catch { return false; }
  if (!a || !b) return false;
  return a !== b;
}

// Host execution is checked against the actual invocation by Session.execute.
// Standard mode reviews external effects; full access is the user's standing grant.
export function approvalCategory(name, args = {}, extra = {}) {
  if (HOST_EXEC.has(name)) return name === 'workspace_npm' ? 'npm' : 'shell';
  if (extra.trustedRisk === 'exec') return 'shell';
  if (DESTRUCTIVE.has(name)) return 'reset';
  if (name === 'get_cookies') return 'sensitive';
  if (name === 'page_call') return 'external';
  if (name === 'evaluate_script') return 'external';
  if (['browser_click', 'browser_fill', 'browser_press'].includes(name)) return 'external';
  if (!CLASSIFIED.has(name) && !['discover_tools'].includes(name) && !extra.trustedRisk) return 'external';
  return null;
}

const LABELS = {
  shell: '运行 shell 命令或本地脚本',
  npm: '安装 npm 依赖',
  overwrite: '覆盖较大的已有文件',
  reset: '重置会话或重启干净浏览器',
};

export function approvalSummary(name, args = {}, category) {
  let detail = '';
  if (name === 'workspace_shell') detail = args.cmd || '';
  else if (name === 'workspace_run') detail = [args.file || args.path || 'index.js', ...(args.args || [])].join(' ');
  else if (name === 'run_node') detail = String(args.code || '').replace(/\s+/g, ' ').slice(0, 200);
  else if (name === 'workspace_npm') detail = [].concat(args.packages || args.package || args.command || 'install').join(' ');
  else if (name === 'workspace_write') detail = args.path || args.file || '';
  else if (name === 'workspace_job_kill') detail = args.id || '';
  else if (name === 'navigate_page' || name === 'new_page') detail = args.url || '';
  else if (name === 'reset_session') detail = args.scope || 'site';
  else if (name === 'restart_browser_fresh') detail = args.url || '';
  else if (name.startsWith('browser_')) detail = JSON.stringify(args);
  detail = String(detail).replace(/\s+/g, ' ').slice(0, 240);
  return `${LABELS[category] || '此操作'}需要确认\n\n${name}${detail ? ' · ' + detail : ''}\n\n批准仅适用于当前显示的动作与工作区。`;
}

export function decideTool(mode, name, args = {}, extra = {}) {
  const m = normalizeMode(mode);
  const risk = extra.trustedRisk || toolRisk(name, args);
  const internal = ['todo_write', 'compact_context', 'ask_user', 'discover_tools', 'workspace_job_kill'].includes(name);
  if (m === 'read-only' && risk !== 'read' && !internal) return { action: 'deny', reason: '当前为只读权限，不能写文件、运行代码或修改远程资源。请由用户切换权限后再操作。', injectConfirm: false };
  if (m === 'full-access') return { action: 'run', injectConfirm: CONFIRM_INJECT.has(name) };
  let category = approvalCategory(name, args || {}, extra);
  // Managed launchers decide against the actual command, immediately before spawn.
  if (HOST_EXEC.has(name) && (extra.runtimeManaged || m === 'full-access')) category = null;
  const injectConfirm = CONFIRM_INJECT.has(name);
  if (category) {
    return { action: 'approve', category, summary: approvalSummary(name, args || {}, category), injectConfirm };
  }
  return { action: 'run', injectConfirm };
}
