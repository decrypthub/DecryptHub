// Derive the presentation from persisted events; never rewrite model history.
export function historyEvents(history, partial = '', partialItem = null, partialReasoning = '') {
  const events = [];
  for (let i = 0; i < (history || []).length; i++) {
    const e = history[i], meta = { id: e.id || 'history-' + i, turnId: e.turnId, at: e.at };
    if (e.t === 'user') {
      if (e.displayContent === undefined && /^【(?:系统|工作区已切换)】/.test(e.content || '')) { events.push({ ...meta, type: 'note', content: e.content }); continue; }
      events.push({ ...meta, type: 'user', content: e.displayContent ?? String(e.content || '').split('\n\n【当前状态')[0].split('\n\n【附件·')[0], attachments: e.attachments || [] });
    } else if (e.t === 'assistant') {
      events.push({ ...meta, type: 'assistant', content: e.content || '', reasoning: typeof e.reasoning === 'string' ? e.reasoning : '', phase: e.phase || (e.calls?.length ? 'commentary' : undefined), finished: true });
      for (const call of e.calls || []) events.push({ type: 'tool', id: call.id, itemId: call.itemId, turnId: e.turnId, at: e.at, name: call.name, args: call.args });
    } else if (e.t === 'tool') {
      const item = [...events].reverse().find(t => t.type === 'tool' && (e.itemId ? t.itemId === e.itemId : t.id === e.id && t.result === undefined));
      if (item) Object.assign(item, { result: e.content, isError: !!e.isError, ms: e.ms });
    } else if (e.t === 'turn-end') events.push({ ...e, type: 'turn-end' });
    else if (e.t === 'summary') events.push({ ...meta, type: 'compact', stage: 'compressed', summary: e.content, ...e.meta });
  }
  if ((partial || partialReasoning) && !events.some(e => e.id === partialItem?.id)) events.push({ ...partialItem, type: 'assistant', phase: 'streaming', content: partial, reasoning: partialReasoning });
  return events;
}

export function conversationTurns(events, run = null, running = false) {
  const turns = [], byId = new Map(); let current;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const id = e.turnId || (e.type === 'user' ? 'legacy-' + i : current?.id || 'legacy-system');
    let turn = byId.get(id);
    if (!turn) { turn = { id, items: [], user: null, startedAt: e.at || 0 }; byId.set(id, turn); turns.push(turn); }
    current = turn;
    if (e.type === 'user') turn.user = e;
    else if (e.type === 'turn-end') { turn.end = e; turn.endedAt = e.endedAt; }
    else turn.items.push(e);
  }
  for (const turn of turns) {
    const lastAssistant = turn.items.findLastIndex(e => e.type === 'assistant');
    turn.process = []; turn.answers = []; turn.alerts = [];
    turn.items.forEach((e, i) => {
      if (e.type === 'assistant') {
        if (e.reasoning) turn.process.push({ type: 'reasoning', id: 'reasoning-' + e.id, content: e.reasoning, finished: e.finished, at: e.at, turnId: e.turnId });
        const phase = e.phase || (i === lastAssistant && !turn.items.slice(i + 1).some(t => t.type === 'tool') ? 'final_answer' : 'commentary');
        if (e.content) (phase === 'commentary' ? turn.process : turn.answers).push({ ...e, phase });
      } else if (e.type === 'error') turn.alerts.push(e);
      else turn.process.push(e);
    });
    turn.active = running && (run?.id ? run.id === turn.id : turn === turns.at(-1));
    turn.status = run?.id === turn.id ? run.status : turn.end?.stop === 'interrupted' ? 'cancelled' : turn.end?.stop === 'error' ? 'failed' : turn.end?.stop && turn.end.stop !== 'completed' ? 'stopped' : 'completed';
    if (turn.active && !['waiting_user', 'waiting_approval'].includes(turn.status)) turn.status = 'running';
    turn.endedAt ||= run?.id === turn.id ? run.endedAt : turn.items.at(-1)?.at;
    if (!turn.active) turn.process = turn.process.map(e => e.type === 'reasoning' ? { ...e, finished: true } : e.type === 'tool' && e.result === undefined ? { ...e, cancelled: true, result: '未收到完成结果；未自动重放此操作。' } : e);
    turn.tools = turn.process.filter(e => e.type === 'tool');
    turn.failures = turn.tools.filter(e => e.isError).length;
  }
  return turns;
}

const TITLES = { workspace_list: '查看文件', workspace_read: '读取文件', workspace_grep: '搜索代码', workspace_write: '写入文件', workspace_edit: '编辑文件', workspace_shell: '运行命令', workspace_run: '运行脚本', workspace_npm: '安装依赖', workspace_job_output: '查看任务输出', workspace_job_kill: '停止后台任务', browser_open: '打开网页', browser_snapshot: '读取页面', browser_tabs: '查看标签页', browser_select: '切换标签页', browser_click: '点击页面', browser_fill: '填写表单', browser_press: '发送按键', todo_write: '更新计划', compact_context: '整理上下文', ask_user: '询问用户', discover_tools: '加载工具' };
Object.assign(TITLES, { agent_spawn: '创建研究子代理', agent_wait: '汇总子代理结论', agent_list: '查看子代理', agent_cancel: '取消子代理', goal_update: '更新目标进展', browser_requests: '查看抓包列表', browser_request_detail: '读取请求详情', browser_capture: '调整抓包状态', list_scripts: '列出页面脚本', get_script_source: '读取脚本源码', save_script_source: '保存脚本源码', search_in_sources: '搜索页面源码', set_breakpoint_on_text: '设置源码断点', break_on_xhr: '设置请求断点', remove_breakpoint: '移除断点', list_breakpoints: '查看断点', get_paused_info: '检查暂停现场', pause_or_resume: '暂停或恢复执行', step: '单步调试', evaluate_script: '在网页中求值', select_frame: '选择页面框架', list_console_messages: '读取控制台', get_websocket_messages: '读取 WebSocket 消息', list_network_requests: '检查网络请求', get_request_initiator: '定位请求调用栈', take_screenshot: '截取网页画面', clear_site_data: '清除站点数据', clear_network_requests: '清空调试请求' });

export function toolPresentation(event) {
  const a = event.args || {}, title = TITLES[event.name] || event.name?.replace('__', ' / ') || '工具调用';
  let detail = a.path || a.file || a.filePath || a.task || a.summary || a.text || a.cmd || a.url || a.pattern || a.query || a.name || a.selector || a.group || '';
  if (event.name === 'workspace_npm') detail = (a.packages || [a.package || a.command || 'install']).join(' ');
  return { title, detail: String(detail).replace(/\s+/g, ' ').slice(0, 160) };
}
export function elapsedLabel(ms) {
  if (!Number.isFinite(ms) || ms < 1000) return '不到 1 秒';
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60);
  return m ? `${m} 分 ${s % 60} 秒` : `${s} 秒`;
}
