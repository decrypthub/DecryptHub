// 对话区：顶栏（会话身份与任务进度）、消息流、输入坞。
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Flex, Text, Badge, Callout, Spinner, Popover } from '@radix-ui/themes';
import { useWorkbench } from './bus.jsx';
import { Button, ActionIcon, Icon, Markdown } from './kit.jsx';
import { fmtK, sessionLabel } from './state.js';
import { native } from './transport.js';
import { PermissionPicker, PendingActions } from './workspace.jsx';
import { AttachmentTiles, ReplyImages } from './attachments.jsx';
import { ReplyMarkdown } from './reply-markdown.jsx';
import { conversationTurns, toolPresentation, elapsedLabel } from './conversation.js';
import { shouldDropPaste, insertWithUndoBoundary } from './paste-drop.js';
import { TurnTrigger } from './turn-trigger.jsx';
import { submitMode } from './submission-policy.js';
import { commandMatches } from './commands.js';
import { CommandInput } from './command-input.jsx';
import { CommandMenu, CommandFeedback, CommandDialogs, commandMenuItems } from './harness.jsx';
import { SubagentButton, TurnSubagents, SubagentNavigation } from './subagents.jsx';
import { SubagentConversation } from './subagent-conversation.jsx';
import { TeamButton } from './team.jsx';
import { TurnFiles } from './turn-files.jsx';
import { TurnNavigator } from './turn-navigator.jsx';
import { handleWindowDrag } from './window-drag.js';
import { PlanButton } from './plan.jsx';
import { GoalDetails, GoalResumeBanner } from './goal-details.jsx';
import { Reasoning } from './reasoning.jsx';
import { processPresentation } from './process-presentation.js';
import { terminalResult, toolState, toolErrorSummary } from './tool-execution.js';
import { installStopShortcut } from './stop-shortcut.js';
import { reasoningOpen, toggleReasoning } from './reasoning-state.js';
import { QueuedMessages } from './queue-strip.jsx';
import { ModelSeat } from './thinking-picker.jsx';
import { modelThinking, effectiveThinking, effectiveTransport } from '../../sidecar/thinking.mjs';
import { useSessionReferences } from './session-references.jsx';
import { useCompositionGuard } from './use-composition-guard.js';
import { isSubmitEnter } from './composition-guard.js';

const CTX_PARTS = [['system', '系统提示'], ['tools', '工具定义'], ['summary', '压缩摘要'], ['history', '对话'], ['attachments', '附件'], ['toolResults', '工具结果']];

export function ChatStage({ railOpen, onExpandRail }) {
  const w = useWorkbench();
  const stageRef = useRef(null), stopState = useRef(null);
  const fileRef = useRef(null), [dragging, setDragging] = useState(false);
  const [commandName, setCommandName] = useState(null), [commandDismissed, setCommandDismissed] = useState(false);
  const [childView, setChildView] = useState(null);
  const [skillCatalog, setSkillCatalog] = useState({ identity: '', items: [] });
  const { cur, session, input, setInput, send, atts, rmAtt, pickModel, inv, refs } = w;
  const composition = useCompositionGuard(w.sid, refs.inputRef);
  const childPath = childView?.sessionId === w.sid ? childView.path : [];
  const navigateChild = path => setChildView({ sessionId: w.sid, path });
  const references = useSessionReferences({ input, setInput, inputRef: refs.inputRef, sid: w.sid, api: w.api, toast: w.toast });
  const catalogIdentity = `${w.sid}:${session?.workspace?.id}:${session?.workspace?.revision}`;
  const menuActive = /^\/[a-z0-9-]*$/i.test(input);
  const skills = skillCatalog.identity === catalogIdentity ? skillCatalog.items : [];
  useEffect(() => {
    if (!w.sid || !menuActive && skillCatalog.identity === catalogIdentity) return;
    let live = true;
    w.api.invoke('extensions-list', { sessionId: w.sid, kind: 'skill' }).then(items => {
      if (live) setSkillCatalog({ identity: catalogIdentity, items: items.filter(item => item.userInvocable !== false).slice(0, 256) });
    }).catch(() => { if (live) setSkillCatalog({ identity: catalogIdentity, items: [] }); });
    return () => { live = false; };
  }, [menuActive, catalogIdentity, w.api]);
  const selected = cur.modelSelection || session?.modelSelection;
  const settings = selected ? { ...w.settings, activeProviderId: selected.providerId, activeModel: selected.model, activeThinking: selected.thinking } : w.settings;
  const turns = useMemo(() => conversationTurns(cur.events, cur.run, cur.agentRunning, cur.subagents), [cur.events, cur.run, cur.agentRunning, cur.subagents]);
  const responding = cur.agentRunning || cur.subagents?.some(a => a.status === 'running');
  const pendingInteraction = !!cur.approvals?.length || !!cur.question;
  stopState.current = { sessionId: w.sid, runId: cur.run?.id, enabled: !childPath.length && w.view === 'chat' && w.conn === 'connected' && !!cur.agentRunning, pendingInteraction };
  const cancelTurn = (sessionId, runId) => w.api.invoke('agent-cancel-turn', { sessionId, runId }).catch(error => w.toast('停止失败：' + error.message, 'err'));
  const stopResponse = () => cur.agentRunning && cur.run?.id ? cancelTurn(w.sid, cur.run.id) : inv('agent-interrupt').catch(error => w.toast('停止失败：' + error.message, 'err'));
  useEffect(() => {
    if (!session || !stageRef.current) return;
    return installStopShortcut(stageRef.current, () => stopState.current, cancelTurn);
  }, [w.sid, cur.run?.id, cur.agentRunning, pendingInteraction, w.conn, w.view, !!session, childPath.length]);
  const hasDraft = !!input.trim() || !!atts.length;
  const primaryStops = responding && !w.sending && (!hasDraft || session?.workspace?.availability !== 'ready');
  const mode = submitMode(w.settings.busyEnter, !!cur.agentRunning);
  const primaryLabel = primaryStops ? '停止响应' : w.sending ? '正在发送' : w.editTarget ? '重新发送（Enter）' : cur.agentRunning && hasDraft && !input.trimStart().startsWith('/') ? mode === 'steer' ? '插话发送（Enter）' : '加入下一轮队列（Enter）' : '发送（Enter）';
  const providers = settings.providers || [];
  const activeProvider = providers.find(p => p.id === settings.activeProviderId);
  const legacyProvider = settings.provider === 'anthropic' ? settings.anthropic : settings.openai;
  const keyOk = !!(activeProvider?.catalogId || activeProvider?.apiKey || activeProvider?.hasKey || legacyProvider?.apiKey || legacyProvider?.hasKey);
  const model = settings.activeModel || '';
  const modelInfo = (activeProvider?.models || []).find(m => (typeof m === 'string' ? m : m.id) === model);
  const vision = typeof modelInfo === 'object' && modelInfo?.vision;
  // 思考档位：只有当前模型确实声明了档位时才给选择器，否则不摆一个切换无效的控件。
  // 发送方式由端点推断（deriveTransport），不听 settings 里存的 transport —— 那是旧版让用户手挑的字段名。
  const declaredThinking = { ...modelThinking(typeof modelInfo === 'object' ? modelInfo?.thinking : null, model), transport: effectiveTransport(typeof modelInfo === 'object' ? modelInfo?.thinking : null, model, activeProvider?.type) };
  const thinking = effectiveThinking(declaredThinking, settings.activeThinking);
  const builtins = commandMatches(input);
  const candidates = menuActive ? [...builtins, ...skills.filter(item => item.name.startsWith(input.slice(1).toLowerCase()) && !commandMatches('/').some(c => c.name === item.name)).map(item => ({ ...item, label: item.name, kind: 'skill' }))] : [];
  const commands = commandDismissed || references.active ? [] : commandMenuItems(candidates), commandId = 'composer-commands-' + w.sid;
  const commandIndex = Math.max(0, commands.findIndex(item => item.name === commandName));
  const chooseCommand = c => { setInput('/' + c.name + ' '); setCommandDismissed(true); setTimeout(() => refs.inputRef.current?.focus(), 0); };
  const composerKey = e => {
    if (composition.isComposing(e)) return;
    if (references.onKeyDown(e)) return;
    if (commands.length && ['ArrowUp', 'ArrowDown', 'Tab', 'Escape', 'Enter'].includes(e.key)) {
      if (e.key === 'Escape') { e.preventDefault(); setCommandDismissed(true); return; }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); setCommandName(commands[(commandIndex + (e.key === 'ArrowDown' ? 1 : -1) + commands.length) % commands.length].name); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && input !== '/' + commands[Math.min(commandIndex, commands.length - 1)].name)) { e.preventDefault(); chooseCommand(commands[Math.min(commandIndex, commands.length - 1)]); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isSubmitEnter(e)) return;
      const accelerated = e.metaKey || e.ctrlKey;
      if (accelerated && !hasDraft && cur.agentRunning) { w.steerQueue().catch(error => w.toast(error.message, 'err')); return; }
      send(false, undefined, submitMode(w.settings.busyEnter, !!cur.agentRunning, accelerated));
    }
  };


  if (childPath.length && session) return <SubagentConversation key={w.sid + ':' + childPath.join('/')} path={childPath} onNavigate={navigateChild} renderTool={event => <ToolEvent e={event} />} />;
  if (!session) return <div className="chat is-empty">
    <header className="stage-head" data-window-drag-region onMouseDown={e => handleWindowDrag(e, native)}>
      {!railOpen && <ActionIcon icon="sidebar" variant="soft" color="gray" onClick={onExpandRail} title="展开会话列表" />}
    </header>
    <div className="welcome"><div className="welcome-inner"><h1>{w.projects.length ? '从项目开始工作' : '添加第一个项目'}</h1><Button mt="4" variant="soft" color="gray" onClick={() => w.setProjectEditor({})}><Icon n="folder" />添加项目目录</Button></div></div>
  </div>;
  return <SubagentNavigation.Provider value={navigateChild}><div ref={stageRef} data-conversation-session={w.sid} className={'chat' + (!cur.events.length ? ' is-empty' : '')}>
    <header className="stage-head" data-window-drag-region onMouseDown={e => handleWindowDrag(e, native)}>
      {!railOpen && <ActionIcon icon="sidebar" variant="soft" color="gray" onClick={onExpandRail} title="展开会话列表" />}
      <div className="stage-identity">
        <strong className="ellipsis" title={sessionLabel(session || {}, settings.titlePrefix)}>{sessionLabel(session || {}, settings.titlePrefix)}</strong>
      </div>
      <Box flexGrow="1" />
      <div className="stage-progress" aria-label="目标、计划与子代理">
        <TeamButton key={'team-' + w.sid} onOpen={id => navigateChild([id])} />
        {cur.goal && <GoalDetails key={'goal-' + w.sid} goal={cur.goal} />}
        <PlanButton key={'plan-' + w.sid} />
        <SubagentButton key={'agents-' + w.sid} />
      </div>
      {w.conn !== 'connected' && <span className="tb-reconnecting" role="status"><Spinner size="1" />连接中…</span>}
    </header>

    {!keyOk && <div className="banner amber">
      <Icon n="info" size={13} />
      <Text size="1">尚未配置模型</Text>
      <Button size="2" variant="ghost" onClick={() => w.setView('settings')}>配置<Icon n="go" size={16} /></Button>
    </div>}
    {cur.run?.status === 'interrupted' && <div className="banner amber"><Icon n="info" /><Text size="1">上次任务已中断。已有改动已保留，可以检查后继续。</Text></div>}
    {cur.run?.status === 'needs_attention' && <div className="banner amber"><Icon n="info" /><Text size="1">自动化需要权限或补充信息，请在此对话中继续处理。</Text></div>}
    <GoalResumeBanner />
    {session?.workspace?.availability !== 'ready' && <div className="banner amber"><Icon n="info" size={13} /><Text size="1">项目目录不可用，执行已停止。聊天记录保留。</Text><Button size="1" variant="ghost" onClick={() => w.api.invoke('projects-check').catch(e => w.toast(e.message, 'err'))}>重新检查</Button><Button size="1" onClick={() => w.setProjectEditor({ ...(w.projects.find(p => p.id === session?.projectId) || {}), relink: true })}>重新选择目录</Button></div>}

    <div className="transcript" data-conversation-region="chat" key={'transcript-' + w.sid}>
    <div className="msgs" ref={refs.bindChat} role="region" aria-label="对话内容" tabIndex={0}
      onClickCapture={event => { if (event.target instanceof Element && event.target.closest('.tool-head, .reason-head, .turn-process > summary, .turn-flow-head')) refs.scrollController.current?.pauseFollowing(); }}>
      {cur.historyLoading && <Flex justify="center" p="3" gap="2"><Spinner size="1" /><Text size="1" color="gray">正在读取对话…</Text></Flex>}
      {cur.historyError && <Callout.Root color="red"><Callout.Text>{cur.historyError}</Callout.Text><Button size="1" variant="soft" onClick={w.reloadHistory}>重新读取</Button></Callout.Root>}
      {!!cur.historyStart && <Flex justify="center" p="3"><Button size="1" variant="soft" color="gray" disabled={cur.historyLoading} onClick={w.loadEarlierHistory}>加载更早的对话</Button></Flex>}
      {cur.events.length === 0
        ? <Welcome onPick={t => { setInput(t); setTimeout(() => refs.inputRef.current?.focus(), 30); }} onOpen={() => { w.setSide('browser'); w.setSideOpen(true); setTimeout(() => { refs.urlRef.current?.focus(); refs.urlRef.current?.select(); }, 60); }} running={cur.status.running} />
        : <div className="msgs-in" ref={refs.bindChatContent}>
            <MessageStream turns={turns} />
            <div className="transcript-commands"><CommandFeedback /><CompactingLine /></div>
          </div>}
      {!cur.events.length && <div className="transcript-commands"><CommandFeedback /><CompactingLine /></div>}
    </div>
    <TurnNavigator turns={turns} scrollRef={refs.chatRef} scrollController={refs.scrollController} />
    </div>

    <div className="composer-wrap" data-conversation-region="composer">
      {(cur.plan?.active || cur.plan?.pending === true) && <div className="banner" role="status"><Icon n="layers" size={13} /><Text size="1">{cur.plan.pending !== null ? '计划模式将在下一步切换' : '计划模式 · 确认计划后实施'}</Text><Button size="1" variant="ghost" onClick={() => w.api.invoke('plan-set', { sessionId: w.sid, active: false }).catch(e => w.toast(e.message, 'err'))}>退出计划模式</Button></div>}
      <PendingActions />
      <CommandDialogs />
      <QueuedMessages key={w.sid} />
      {w.editTarget && <div className="edit-banner" role="status"><Icon n="edit" size={13} /><Text size="1">正在编辑已发送的消息，发送后创建分支并保留原对话</Text><span className="spacer" /><Button size="1" variant="ghost" color="gray" onClick={w.cancelEdit}>取消</Button></div>}
      <Box className={'composer' + (dragging ? ' drag-over' : '')} p="3"
        onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); }}
        onDrop={e => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length) w.addFiles(e.dataTransfer.files); }}>
        <AttachmentTiles items={atts} sessionId={w.sid} invoke={w.api.invoke} onRemove={rmAtt} />
        {w.uploading && <Flex align="center" gap="2" mb="2"><Spinner size="1" /><Text size="1" color="gray">正在添加附件…</Text></Flex>}
        {atts.some(a => a.image) && !vision && <Flex gap="2" align="center" mb="2" wrap="wrap"><Text size="1" color="amber">当前模型未启用图片输入</Text><Button size="1" variant="ghost" color="gray" onClick={w.enableImages} title="仅在该模型支持图片时启用">启用图片输入</Button></Flex>}
        {dragging && <div className="drop-hint">松开以添加图片或文件</div>}
        <CommandInput className="composer-input" size="2" variant="soft" color="gray" resize="none" ref={composition.ref} value={input} skills={skills} rows={2}
          onPaste={e => {
            const files = Array.from(e.clipboardData?.items || []).filter(item => item.kind === 'file').map(item => item.getAsFile()).filter(Boolean);
            if (files.length) { e.preventDefault(); w.addFiles(files); return; }
            const text = e.clipboardData?.getData('text/plain') || '';
            if (shouldDropPaste(text)) { e.preventDefault(); w.dropPaste(text); return; }
            // 普通文本粘贴：交给我们自己插入，好把这次粘贴做成独立的撤销边界。
            // 不覆盖的话，React 受控组件会打断浏览器原生 undo 栈，Ctrl+Z 经常
            // 一次性把「粘贴内容 + 之后的输入」全删掉，或者干脆什么都不撤。
            e.preventDefault();
            insertWithUndoBoundary(e.currentTarget, text, setInput, e.currentTarget.selectionStart, e.currentTarget.selectionEnd);
          }}
          onChange={e => { references.update(e.currentTarget); setInput(e.target.value); setCommandName(null); setCommandDismissed(false); e.target.style.height = 'auto'; e.target.style.height = Math.min(180, e.target.scrollHeight) + 'px'; }}
          onClick={e => references.update(e.currentTarget)} onKeyUp={e => { if (!['Escape', 'Enter', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.key)) references.update(e.currentTarget); }}
          onKeyDown={composerKey}
          aria-controls={references.items.length ? references.id : commands.length ? commandId : undefined} aria-activedescendant={references.items.length ? references.id + '-' + references.selected : commands.length ? commandId + '-' + Math.min(commandIndex, commands.length - 1) : undefined} aria-autocomplete="list" aria-expanded={commands.length > 0 || references.items.length > 0}
          aria-label="任务指令"
          title="Enter 发送，Shift+Enter 换行"
          placeholder={w.editTarget ? '修改后按 Enter 重新发送…' : cur.agentRunning ? (!hasDraft && cur.queuedItems?.length ? 'Cmd/Ctrl+Enter 插话发送全部排队消息' : mode === 'steer' ? '补充要求，Enter 插话发送…' : '补充要求，Enter 排队，Cmd/Ctrl+Enter 插话…') : '输入任务，粘贴图片，或输入 / 查看命令…'} />
        {!!commands.length && <CommandMenu items={commands} selected={commandIndex} choose={chooseCommand} anchor={refs.inputRef} id={commandId} onHighlight={index => setCommandName(commands[index].name)} onDismiss={() => setCommandDismissed(true)} />}
        {!!references.items.length && <CommandMenu items={references.items} selected={references.selected} choose={references.choose} anchor={refs.inputRef} id={references.id} ariaLabel="引用历史会话" />}
        <div className="composer-bar">
          <input ref={fileRef} type="file" hidden multiple aria-label="选择附件文件" accept="image/png,image/jpeg,image/webp,image/gif,.md,.txt,.json,.js,.mjs,.cjs,.ts,.tsx,.jsx,.py,.html,.css,.csv,.yaml,.yml,.toml,.rs,.go,.java,.sh,.ps1" onChange={e => { w.addFiles(e.target.files); e.target.value = ''; }} />
          <ActionIcon icon="plus" variant="soft" color="gray" onClick={() => fileRef.current?.click()} title="添加图片或文件" />
          <div className="composer-mode"><PermissionPicker /></div>
          <Box flexGrow="1" />
          <div className="composer-context"><CtxMeter /></div>
          <div className="composer-seat"><ModelSeat
            providers={providers} providerId={settings.activeProviderId || ''} model={model}
            levels={declaredThinking.levels} value={thinking.level}
            defaultLevel={declaredThinking.default}
            onPickModel={(pid, m) => pickModel(pid, m)} onPickThinking={level => w.pickThinking(level)} /></div>
          {responding && w.sending && <ActionIcon icon="stop" variant="ghost" color="gray" onClick={stopResponse} title="停止响应（Esc Esc）" />}
          <ActionIcon icon={primaryStops ? 'stop' : 'send'} className="send-button" variant="solid" onClick={() => primaryStops ? stopResponse() : send(false, undefined, mode)}
            disabled={!primaryStops && (w.session?.workspace?.availability !== 'ready' || w.sending || w.uploading || !hasDraft)}
            title={primaryStops && cur.agentRunning ? '停止响应（Esc Esc）' : primaryLabel} />
        </div>
      </Box>
    </div>
  </div></SubagentNavigation.Provider>;
}

function MessageStream({ turns }) {
  let lastDate = '';
  return turns.map((turn, index) => {
    const date = turn.user?.at ? new Date(turn.user.at).toLocaleDateString('zh-CN') : '';
    const showDate = date && date !== lastDate; if (date) lastDate = date;
    return <section className="conversation-turn" key={turn.id} data-turn-id={turn.id} aria-label={`第 ${index + 1} 轮对话`}>
      {showDate && <div className="conversation-date">{date === new Date().toLocaleDateString('zh-CN') ? '今天' : date}</div>}
      {turn.user && <Event e={turn.user} turn={turn} canEdit={!turn.active} />}
      {turn.trigger && <TurnTrigger trigger={turn.trigger} turn={turn} />}
      <TurnProcess turn={turn} />
      {!turn.answers.length && <TurnFiles turn={turn} />}
      {turn.alerts.map((e, i) => <Event key={e.id || i} e={e} />)}
      {turn.markers.map(e => <Event key={e.id} e={e} />)}
    </section>;
  });
}

function TurnProcess({ turn }) {
  const { cur, presentation: view } = useWorkbench();
  const [expanded, setExpanded] = useState(null), [now, setNow] = useState(Date.now());
  const presentation = processPresentation(turn), open = expanded ?? presentation.defaultOpen, hasReasoning = turn.process.some(e => e.type === 'reasoning');
  useEffect(() => { if (!turn.active) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [turn.active]);
  const currentTool = turn.tools.findLast(t => t.result === undefined);
  const elapsed = turn.startedAt ? elapsedLabel((turn.active ? now : turn.endedAt || turn.startedAt) - turn.startedAt) : '';
  const retry = turn.active && cur.retry, retryWait = retry && Math.max(0, Math.ceil((retry.retryAt - now) / 1000));
  const label = turn.status === 'waiting_approval' ? '等待批准' : turn.status === 'waiting_user' ? '等待你的回答' : retry ? `模型连接重试 ${retry.attempt}/${retry.maxRetries}${retryWait ? ` · ${retryWait} 秒后重连` : ' · 正在重连'}` : turn.active ? currentTool ? toolPresentation(currentTool).title : cur.thinking ? '正在思考' : '正在回复' : turn.status === 'cancelled' ? '已停止' : turn.status === 'failed' ? '执行未完成' : turn.status === 'needs_attention' ? '需要你处理' : turn.status === 'stopped' ? '已暂停' : elapsed ? '用时 ' + elapsed : '执行过程';
  // 与 DSH 一样按动作归类：先说做了什么，再给失败/子代理数量，避免只留一个「N 项操作」。
  const kinds = new Map();
  for (const item of turn.tools) { const title = toolPresentation(item).title; kinds.set(title, (kinds.get(title) || 0) + 1); }
  const kindSummary = [...kinds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([title, n]) => n > 1 ? `${title} ${n}` : title);
  const count = [hasReasoning && '思考', kindSummary.join(' · ') || (turn.tools.length ? `${turn.tools.length} 项操作` : ''), turn.subagents.length && `子代理 ${turn.subagents.length}`, turn.failures && `失败 ${turn.failures}`].filter(Boolean).join(' · ');
  const stopped = ['cancelled', 'stopped'].includes(turn.status);
  const header = <><span className={'tool-state ' + (turn.active ? 'run' : turn.failures ? 'err' : stopped ? 'cancelled' : 'ok')}>{turn.active ? <Spinner size="1" /> : <Icon n={stopped ? 'stop' : turn.failures ? 'info' : 'check'} size={13} />}</span><span className="turn-process-label" title={label}>{label}</span>{turn.active && elapsed && <span className="turn-process-elapsed">{elapsed}</span>}{count && <span className="tool-count" title={count}>{count}</span>}</>;
  const answers = new Map(turn.answers.map(event => [event.id, event]));
  const rows = [];
  for (const [index, event] of turn.items.entries()) {
    if (['compact', 'error'].includes(event.type)) continue;
    const identity = event.itemId || event.id || index;
    if (event.type === 'assistant' && event.reasoning) rows.push(<div className="turn-flow-item turn-work-item" hidden={!open} key={'reasoning-' + identity}><Reasoning event={{ type: 'reasoning', id: 'reasoning-' + event.id, content: event.reasoning, finished: event.finished, at: event.at, turnId: event.turnId }} open={reasoningOpen(view, { id: 'reasoning-' + event.id })} onToggle={ev => { const next = toggleReasoning(view, ev); if (next) view.setReasoningOpen(next); }} /></div>);
    if (event.type === 'assistant' && !event.content) continue;
    const answer = answers.get(event.id), work = !answer && event.type !== 'user';
    rows.push(<div className={'turn-flow-item' + (work ? ' turn-work-item' : '')} hidden={work && !open} key={'item-' + identity}>{event.type === 'tool' ? <ToolEvent e={event} /> : <Event e={answer || event} turn={turn} />}</div>);
  }
  const hasWork = !!turn.process.length || !!turn.subagents.length || turn.active;
  return <div className="turn-flow">
    {hasWork && <button type="button" className="turn-meta turn-flow-head" aria-label="执行过程" aria-expanded={open} onClick={() => setExpanded(!open)}>{header}<Icon n={open ? 'chevup' : 'chevdown'} size={12} /></button>}
    <div className="turn-flow-items" key="flow">{rows}{!!turn.subagents.length && <div className="turn-flow-item turn-work-item" hidden={!open}><TurnSubagents agents={turn.subagents} /></div>}</div>
  </div>;
}

function ToolEvent({ e }) {
  const [open, setOpen] = useState(false);
  const w = useWorkbench();
  const st = toolState(e), terminal = terminalResult(e);
  const resultLabel = e.cancelled ? '已停止' : terminal?.label;
  const format = value => typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const duration = e.ms == null ? '' : e.ms < 1000 ? `${e.ms} ms` : `${(e.ms / 1000).toFixed(1)} s`;
  const presentation = toolPresentation(e);
  const errorSummary = toolErrorSummary(e), detail = errorSummary ?? presentation.detail;
  return <div className={'tool' + (open ? ' expanded' : '')} data-state={st}>
    <button className="tool-head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
      {st !== 'ok' && <span className="sr-only">{st === 'run' ? '执行中' : st === 'cancelled' ? '已停止' : '执行失败'}</span>}
      <span className={'tool-state ' + st}>{st === 'run' ? <Spinner size="1" /> : <Icon n={st === 'err' ? 'info' : st === 'cancelled' ? 'stop' : 'check'} size={13} />}</span>
      <span className="tool-name" title={e.name}>{presentation.title}</span>
      <span className={'tool-arg mono' + (errorSummary ? ' is-error' : '')} title={detail}>{detail ? '· ' + detail : ''}</span>
      {resultLabel && <span className={'tool-result-status' + (terminal?.failed ? ' is-error' : '')} title={resultLabel}>{resultLabel}</span>}
      <span className="tool-duration">{duration}</span>
      <Icon n={open ? 'chevup' : 'chevdown'} size={11} />
    </button>
    {open && <div className="tool-body"><div className="tool-section-label">{e.name}<span>{duration}</span></div><div className="tool-io"><ToolPayload label="输入" text={format(e.args || {})} />{terminal?.label && <div className={'tool-execution-status' + (terminal.failed ? ' is-error' : '')} role="status">{terminal.label}</div>}<ToolPayload label="输出" text={e.result === undefined ? '执行中…' : terminal?.output ?? format(e.result)} state={st} /></div></div>}
    {/* 截图等工具产出的图片：折叠状态下也贴在工具条下方，用户和模型都不用再转述。 */}
    {!!e.images?.length && <div className="tool-images"><ReplyImages items={e.images} sessionId={w.sid} invoke={w.api.invoke} /></div>}
  </div>;
}

function ToolPayload({ label, text, state }) {
  const { toast } = useWorkbench();
  return <section className="tool-payload" aria-label={'工具' + label}><div className="tool-payload-label">{label}</div><pre tabIndex={0} data-state={state}>{text}</pre><ActionIcon className="tool-payload-copy" icon="copy" size="1" variant="ghost" color="gray" title={'复制工具' + label} onClick={async () => { try { await navigator.clipboard.writeText(text); toast('已复制', 'ok'); } catch { toast('复制失败', 'err'); } }} /></section>;
}

function AssistantMessage({ e, turn, copy }) {
  const w = useWorkbench(), rating = w.cur.ratings?.[e.id] || '';
  const usage = turn?.usage || null;
  // 「用量」这一格是**整轮计费量**（每一步都会重发全量 prompt，所以它累加起来会超过窗口），
  // 与环上的「窗口占用」是两件事。不写清就会看到「1M 窗口用了 3.8M」这种自相矛盾的读数。
  const tokens = usage ? (usage.prompt || 0) + (usage.completion || 0) : 0;
  const calls = usage?.calls || 0;
  const pct = w.cur.ctx?.used && w.cur.ctx?.limit ? Math.round(w.cur.ctx.used / w.cur.ctx.limit * 100) : null;
  const usageTitle = usage ? [`本轮累计计费 ${fmtK(tokens)} tok`, calls ? `共 ${calls} 次模型调用` : '', pct != null ? `当前窗口占用 ${pct}%` : '', '计费是累加值，窗口占用看输入框右侧的圆环'].filter(Boolean).join('\n') : '';
  const closing = e.phase === 'final_answer' && turn?.answers.at(-1)?.id === e.id;
  const complete = closing && !!turn?.endedAt;
  const time = complete ? new Date(turn.endedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '';
  const final = e.phase === 'final_answer';
  // 本轮所有工具产出的图片（截图、reply_image）。正文里用 image:<id> 指过位置的会被排除，
  // 剩下的附在回复末尾——否则模型把图发在中间步骤时，用户只看得到一句「已发送图片」。
  const images = useMemo(() => closing ? (turn?.tools || []).flatMap(t => t.images || []) : [], [closing, turn]);
  return <article aria-label="模型回复" className={'msg assistant' + (e.phase === 'commentary' ? ' commentary' : '') + (e.phase === 'streaming' ? ' is-streaming' : '')}>
    <div className="bubble"><ReplyMarkdown text={e.content} images={images} sessionId={w.sid} invoke={w.api.invoke} streaming={e.phase === 'streaming'} /></div>
    {complete && turn.answers.at(-1)?.id === e.id && <TurnFiles turn={turn} />}
    {closing && <div className="message-foot">
      <ActionIcon icon="copy" size="1" variant="ghost" color="gray" onClick={copy} title="复制回复" aria-label="复制回复" />
      {complete && Number.isSafeInteger(turn.end.seq) && <ActionIcon icon="branch" size="1" variant="ghost" color="gray" title="从此处分支" onClick={() => w.api.invoke('session-fork', { sessionId: w.sid, atSeq: turn.end.seq }).catch(error => w.toast(error.message, 'err'))} />}
      <ActionIcon icon="thumbup" size="1" variant="ghost" color={rating === 'up' ? 'tomato' : 'gray'} onClick={() => w.rate(e.id, 'up')} title={rating === 'up' ? '取消“有帮助”' : '标记为有帮助'} aria-label="有帮助" aria-pressed={rating === 'up'} />
      <ActionIcon icon="thumbdown" size="1" variant="ghost" color={rating === 'down' ? 'tomato' : 'gray'} onClick={() => w.rate(e.id, 'down')} title={rating === 'down' ? '取消“没帮助”' : '标记为没帮助'} aria-label="没帮助" aria-pressed={rating === 'down'} />
      <span className="spacer" />
      {tokens > 0 && <Text size="1" color="gray" title={usageTitle}>本轮 {fmtK(tokens)} tok{calls > 1 ? ` · ${calls} 次调用` : ''}</Text>}
      {time && <Text size="1" color="gray" className="message-time">{time}</Text>}
    </div>}
  </article>;
}
function Event({ e, turn, canEdit = false }) {
  const [open, setOpen] = useState(false);
  const w = useWorkbench(), { toast } = w;
  const copy = async () => { try { await navigator.clipboard.writeText(e.rawContent || e.content); toast('已复制', 'ok'); } catch { toast('复制失败', 'err'); } };
  if (e.type === 'user') return <article className="msg user"><div className="user-message"><div className="bubble">{e.content && <div className="user-content">{e.content}</div>}<AttachmentTiles items={e.attachments || e.atts || []} sessionId={w.sid} invoke={w.api.invoke} /></div><div className="message-meta">{e.at && <time dateTime={new Date(e.at).toISOString()}>{new Date(e.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time>}{e.attachments?.length > 0 && <ActionIcon icon="plus" variant="ghost" color="gray" onClick={() => w.addAtt(e.attachments.map(a => ({ ...a, key: a.id || a.path || a.file })))} title="重新使用附件" />}{e.content && <ActionIcon icon="copy" variant="ghost" color="gray" onClick={copy} title="复制消息" />}{canEdit && (e.content || e.attachments?.length) && <ActionIcon icon="edit" variant="ghost" color="gray" onClick={() => w.startEdit(turn)} title="编辑并重新发送" />}</div></div></article>;
  if (e.type === 'assistant') return e.content ? <AssistantMessage e={e} turn={turn} copy={copy} /> : null;
  if (e.type === 'error') return <Callout.Root size="1" color="red"><Callout.Icon><Icon n="info" size={14} /></Callout.Icon><Callout.Text>{e.content}</Callout.Text></Callout.Root>;
  if (e.type === 'note') return <Callout.Root size="1" color="gray"><Callout.Icon><Icon n="info" size={14} /></Callout.Icon><Callout.Text>{e.content}</Callout.Text></Callout.Root>;
  if (e.type === 'compact') {
    const label = e.stage === 'pruned' ? `收起 ${e.pruned} 个旧工具结果` : `${e.reason === 'auto' ? '自动' : e.reason === 'overflow' ? '上游超限后' : ''}压缩 ${e.summarized || ''} 条较早消息`;
    return <div className="compact-line">
      <button className="compact-trigger" disabled={!e.summary} onClick={() => setOpen(o => !o)} aria-expanded={open} title={`${label} · ${fmtK(e.before)} → ${fmtK(e.after)}`}>
        <Icon n={open ? 'chevdown' : 'layers'} size={14} /><span>上下文已压缩</span><span className="command-separator">·</span><span className="compact-count">{fmtK(e.before)} → {fmtK(e.after)} tokens</span>
      </button>
      {open && <div className="compact-body"><Text size="1" color="gray">{label} · {fmtK(e.before)} → {fmtK(e.after)}</Text><Markdown text={e.summary} /></div>}
    </div>;
  }
  return null;
}

/**
 * 压缩进行中的那一行。和完成后的 `compact-line` 占同一个位置、用同一套骨架，
 * 所以「正在进行 → 已压缩」是**原地替换**，不会多出一条没人清理的临时行。
 * 只在真正压缩时出现（读 agent 的 compressing，而不是本地猜）。
 */
function CompactingLine() {
  const w = useWorkbench(), ctx = w.cur.ctx;
  const busy = w.commandFeedback?.state === 'running' && w.commandFeedback?.name === 'compact';
  if (!ctx?.compressing || busy) return null;
  return <div className="compact-line compacting" role="status">
    <span className="compact-trigger"><Spinner size="1" /><span>正在压缩上下文…</span></span>
  </div>;
}

function Welcome({ onPick, onOpen, running }) {
  const SUGG = [
    ['folder', '了解项目', '先阅读当前工作文件夹的项目说明和代码，向我介绍架构、启动方式和需要关注的问题。'],
    ['code', '编写代码', '帮我在当前工作区创建一个可直接运行的小工具。先结合已有文件理解项目，再与我确认必要的功能细节。'],
    ['file', '整理资料', '先查看工作区里的资料，帮我归纳重点，并整理成一份清晰的 Markdown 文档。'],
  ];
  return <div className="welcome">
    <div className="welcome-inner">
      <h1>开始一个任务</h1>
      <div className="welcome-actions">
        <Button size="3" variant="soft" color="gray" className="suggestion" onClick={onOpen}><Icon n="globe" size={18} /><span>{running ? '继续浏览网站' : '打开目标网站'}</span></Button>
        {SUGG.map(([icon, title, prompt]) => <Button size="3" variant="soft" color="gray" className="suggestion" key={title} onClick={() => onPick(prompt)}><Icon n={icon} size={18} /><span>{title}</span></Button>)}
      </div>
      <p className="welcome-hint">先选择项目，所有对话与文件操作都围绕项目目录展开。</p>
    </div>
  </div>;
}

// 上下文用量：圆环 + 百分比。它是随时回答「窗口还剩多少」的唯一入口，
// 所以静止时也要看得见（其余安静控件静止是透明的），环和数字都不能再靠灰阶区分。
function CtxMeter() {
  const { cur } = useWorkbench();
  const [open, setOpen] = useState(false);
  const ctx = cur.ctx;
  const pct = Math.min(1, ctx?.pct || 0);
  const at = ctx?.trigger && ctx?.limit ? ctx.trigger / ctx.limit : 0.85;
  const parts = ctx?.parts || {};
  const tone = !ctx ? 'idle' : pct >= at ? 'full' : pct >= at - 0.2 ? 'warn' : 'ok';
  const R = 7.6, C = 2 * Math.PI * R;
  const text = ctx ? `${Math.round(pct * 100)}%` : '—';
  if (!ctx?.limit) return null;
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger>
      <button type="button" className={'ctx-meter ' + tone} aria-label="上下文用量" aria-expanded={open}
        title={ctx ? `上下文已用 ${fmtK(ctx.used)} / ${fmtK(ctx.limit)}（${Math.round(pct * 100)}%）· ${Math.round(at * 100)}% 时自动压缩` : '上下文用量尚未统计'}>
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="10" cy="10" r={R} fill="none" strokeWidth="3" className="ctx-ring-track" />
          {pct > 0 && <circle cx="10" cy="10" r={R} fill="none" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${C * pct} ${C}`} className="ctx-ring-arc" />}
        </svg>
        <span className="ctx-meter-num">{text}</span>
      </button>
    </Popover.Trigger>
    <Popover.Content width="340px" align="end" aria-label="上下文用量" data-overlay>
      <div className="ctx-head">
        <span className="ctx-head-num">{Math.round(pct * 100)}<i>%</i></span>
        <span className="ctx-head-tokens">已用 ~{fmtK(ctx?.used)} / {fmtK(ctx?.limit)}</span>
      </div>
      <div className="ctx-bar">{CTX_PARTS.map(([k]) => parts[k] > 0 && <i key={k} className={'sw-' + k} style={{ flex: parts[k] }} />)}{ctx?.limit > 0 && <i className="ctx-rest" style={{ flex: Math.max(0, ctx.limit - (ctx.used || 0)) }} />}<span className="ctx-limit" style={{ left: at * 100 + '%' }} title={`${Math.round(at * 100)}% 自动压缩`} /></div>
      <div className="ctx-rows">{CTX_PARTS.map(([k, l]) => <Flex key={k} justify="between" align="center" style={{ opacity: parts[k] ? 1 : .45 }}>
        <Text size="1"><i className={'sw sw-' + k} />{l}</Text><Text size="1" color="gray">{fmtK(parts[k] || 0)}</Text>
      </Flex>)}</div>
      <Text as="div" size="1" color="gray" mt="2">{Math.round(at * 100)}% 时自动压缩{ctx?.compressions ? ` · 已压缩 ${ctx.compressions} 次` : ''}{ctx?.inferred ? ' · 窗口按模型推断' : ''}</Text>
    </Popover.Content>
  </Popover.Root>;
}
