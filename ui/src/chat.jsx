// 对话区：顶栏（会话身份与任务进度）、消息流、输入坞。
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Flex, Text, Badge, Callout, Spinner, TextArea, Separator, Popover } from '@radix-ui/themes';
import { useWorkbench } from './bus.jsx';
import { Button, ActionIcon, Icon, Markdown, Dropdown } from './kit.jsx';
import { fmtK, sessionLabel } from './state.js';
import { native } from './transport.js';
import { PermissionPicker, PendingActions, RuntimePicker } from './workspace.jsx';
import { ProjectPicker } from './projects.jsx';
import { AttachmentTiles } from './attachments.jsx';
import { conversationTurns, toolPresentation, elapsedLabel } from './conversation.js';
import { commandMatches } from './commands.js';
import { CommandMenu, CommandFeedback, CommandDialogs } from './harness.jsx';
import { SubagentButton, TurnSubagents } from './subagents.jsx';
import { TurnNavigator } from './turn-navigator.jsx';
import { handleWindowDrag } from './window-drag.js';
import { PlanButton } from './plan.jsx';
import { GoalDetails } from './goal-details.jsx';
import { Reasoning } from './reasoning.jsx';
import { processPresentation } from './process-presentation.js';
import { QueuedMessages } from './queue-strip.jsx';

const CTX_PARTS = [['system', '系统提示'], ['tools', '工具定义'], ['summary', '压缩摘要'], ['history', '对话'], ['attachments', '附件'], ['toolResults', '工具结果']];

export function ChatStage({ railOpen, onExpandRail }) {
  const w = useWorkbench();
  const fileRef = useRef(null), [dragging, setDragging] = useState(false);
  const [commandIndex, setCommandIndex] = useState(0), [commandDismissed, setCommandDismissed] = useState(false);
  const { cur, session, input, setInput, send, atts, rmAtt, settings, pickModel, inv, refs } = w;
  const turns = useMemo(() => conversationTurns(cur.events, cur.run, cur.agentRunning, cur.subagents), [cur.events, cur.run, cur.agentRunning, cur.subagents]);
  const responding = cur.agentRunning || cur.subagents?.some(a => a.status === 'running');
  const providers = settings.providers || [];
  const activeProvider = providers.find(p => p.id === settings.activeProviderId);
  const keyOk = !!(activeProvider?.apiKey || activeProvider?.hasKey || (settings.provider === 'anthropic' ? settings.anthropic : settings.openai)?.apiKey);
  const model = settings.activeModel || '';
  const modelInfo = (activeProvider?.models || []).find(m => (typeof m === 'string' ? m : m.id) === model);
  const vision = typeof modelInfo === 'object' && modelInfo?.vision;
  const commands = commandDismissed ? [] : commandMatches(input), commandId = 'composer-commands-' + w.sid;
  const chooseCommand = c => { setInput('/' + c.name + ' '); setCommandDismissed(true); setTimeout(() => refs.inputRef.current?.focus(), 0); };
  const composerKey = e => {
    if (e.nativeEvent.isComposing) return;
    if (commands.length && ['ArrowUp', 'ArrowDown', 'Tab', 'Escape', 'Enter'].includes(e.key)) {
      if (e.key === 'Escape') { e.preventDefault(); setCommandDismissed(true); return; }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); setCommandIndex(i => (i + (e.key === 'ArrowDown' ? 1 : -1) + commands.length) % commands.length); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && input !== '/' + commands[Math.min(commandIndex, commands.length - 1)].name)) { e.preventDefault(); chooseCommand(commands[Math.min(commandIndex, commands.length - 1)]); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(false); }
  };


  if (!session) return <div className="chat is-empty">
    <header className="stage-head" data-window-drag-region onMouseDown={e => handleWindowDrag(e, native)}>
      {!railOpen && <ActionIcon icon="sidebar" variant="soft" color="gray" onClick={onExpandRail} title="展开会话列表" />}<ProjectPicker />
    </header>
    <div className="welcome"><h1>{w.projects.length ? '从项目开始工作' : '添加第一个项目'}</h1><p className="welcome-hint">选择项目目录，然后在项目下创建会话。</p><Button variant="soft" color="gray" onClick={() => w.setProjectEditor({})}><Icon n="folder" />添加项目目录</Button></div>
  </div>;
  return <div className={'chat' + (!cur.events.length ? ' is-empty' : '')}>
    <header className="stage-head" data-window-drag-region onMouseDown={e => handleWindowDrag(e, native)}>
      {!railOpen && <ActionIcon icon="sidebar" variant="soft" color="gray" onClick={onExpandRail} title="展开会话列表" />}
      <ProjectPicker />
      <div className="stage-identity">
        <strong className="ellipsis" title={sessionLabel(session || {})}>{sessionLabel(session || {})}</strong>
      </div>
      <RuntimePicker />
      <Box flexGrow="1" />
      <div className="stage-progress" aria-label="目标、计划与子代理">
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
    {session?.workspace?.availability !== 'ready' && <div className="banner amber"><Icon n="info" size={13} /><Text size="1">项目目录不可用，执行已停止。聊天记录保留。</Text><Button size="1" variant="ghost" onClick={() => w.api.invoke('projects-check').catch(e => w.toast(e.message, 'err'))}>重新检查</Button><Button size="1" onClick={() => w.setProjectEditor({ ...(w.projects.find(p => p.id === session?.projectId) || {}), relink: true })}>重新选择目录</Button></div>}

    <div className="transcript" key={'transcript-' + w.sid}>
    <div className="msgs" ref={refs.chatRef} role="region" aria-label="对话内容" tabIndex={0}>
      {cur.events.length === 0
        ? <Welcome onPick={t => { setInput(t); setTimeout(() => refs.inputRef.current?.focus(), 30); }} onOpen={() => { w.setSide('browser'); w.setSideOpen(true); setTimeout(() => { refs.urlRef.current?.focus(); refs.urlRef.current?.select(); }, 60); }} running={cur.status.running} />
        : <div className="msgs-in">
            <MessageStream turns={turns} />
          </div>}
    </div>
    <TurnNavigator turns={turns} scrollRef={refs.chatRef} />
    </div>

    <div className="composer-wrap">
      <CommandFeedback />
      <PendingActions />
      <CommandDialogs />
      <QueuedMessages />
      {w.editTarget && <div className="edit-banner" role="status"><Icon n="edit" size={13} /><Text size="1">正在编辑已发送的消息，发送后替换原消息</Text><span className="spacer" /><Button size="1" variant="ghost" color="gray" onClick={w.cancelEdit}>取消</Button></div>}
      <Box className={'composer' + (dragging ? ' drag-over' : '')} p="3"
        onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); }}
        onDrop={e => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length) w.addFiles(e.dataTransfer.files); }}>
        <AttachmentTiles items={atts} sessionId={w.sid} invoke={w.api.invoke} onRemove={rmAtt} />
        {w.uploading && <Flex align="center" gap="2" mb="2"><Spinner size="1" /><Text size="1" color="gray">正在添加附件…</Text></Flex>}
        {atts.some(a => a.image) && !vision && <Flex gap="2" align="center" mb="2" wrap="wrap"><Text size="1" color="amber">当前模型未启用图片输入</Text><Button size="1" variant="ghost" color="gray" onClick={w.enableImages} title="仅在该模型支持图片时启用">启用图片输入</Button></Flex>}
        {dragging && <div className="drop-hint">松开以添加图片或文件</div>}
        <TextArea className="composer-input" size="2" variant="soft" color="gray" resize="none" ref={refs.inputRef} value={input} rows={2}
          onPaste={e => { const files = Array.from(e.clipboardData?.items || []).filter(item => item.kind === 'file').map(item => item.getAsFile()).filter(Boolean); if (files.length) { e.preventDefault(); w.addFiles(files); } }}
          onChange={e => { setInput(e.target.value); setCommandIndex(0); setCommandDismissed(false); e.target.style.height = 'auto'; e.target.style.height = Math.min(180, e.target.scrollHeight) + 'px'; }}
          onKeyDown={composerKey}
          aria-controls={commands.length ? commandId : undefined} aria-activedescendant={commands.length ? commandId + '-' + Math.min(commandIndex, commands.length - 1) : undefined} aria-autocomplete="list" aria-expanded={commands.length > 0}
          aria-label="任务指令"
          title="Enter 发送，Shift+Enter 换行"
          placeholder={w.editTarget ? '修改后按 Enter 重新发送…' : cur.agentRunning ? '补充要求，或输入 / 查看命令…' : '输入任务，粘贴图片，或输入 / 查看命令…'} />
        {!!commands.length && <CommandMenu items={commands} selected={Math.min(commandIndex, commands.length - 1)} choose={chooseCommand} anchor={refs.inputRef} id={commandId} />}
        <div className="composer-bar">
          <input ref={fileRef} type="file" hidden multiple aria-label="选择附件文件" accept="image/png,image/jpeg,image/webp,image/gif,.md,.txt,.json,.js,.mjs,.cjs,.ts,.tsx,.jsx,.py,.html,.css,.csv,.yaml,.yml,.toml,.rs,.go,.java,.sh,.ps1" onChange={e => { w.addFiles(e.target.files); e.target.value = ''; }} />
          <ActionIcon icon="plus" variant="soft" color="gray" onClick={() => fileRef.current?.click()} title="添加图片或文件" />
          <div className="composer-mode"><PermissionPicker /></div>
          <Box flexGrow="1" />
          <div className="composer-context"><CtxMeter /></div>
          <div className="composer-model"><Dropdown width={110} label="选择模型" value={(providers.find(p => p.id === settings.activeProviderId)?.id || '') + '|' + model}
            placeholder={providers.length ? '选择模型' : '选择渠道'}
            options={providers.map(p => ({ group: p.name, items: (p.models || []).map(m => { const id = typeof m === 'string' ? m : m.id; return { value: p.id + '|' + id, label: (m && m.name) || id }; }) }))}
            onChange={v => { const i = v.indexOf('|'); if (i > 0) pickModel(v.slice(0, i), v.slice(i + 1)); }} /></div>
          <ActionIcon icon={responding ? 'stop' : 'send'} className="send-button" variant="solid" onClick={() => responding ? inv('agent-interrupt') : send(false)}
            disabled={!responding && (w.session?.workspace?.availability !== 'ready' || w.sending || w.uploading || (!input.trim() && !atts.length))}
            title={responding ? '停止响应' : w.editTarget ? '重新发送（Enter）' : '发送（Enter）'} />
        </div>
      </Box>
    </div>
  </div>;
}

function MessageStream({ turns }) {
  let lastDate = '';
  return turns.map((turn, index) => {
    const date = turn.user?.at ? new Date(turn.user.at).toLocaleDateString('zh-CN') : '';
    const showDate = date && date !== lastDate; if (date) lastDate = date;
    return <section className="conversation-turn" key={turn.id} data-turn-id={turn.id} aria-label={`第 ${index + 1} 轮对话`}>
      {showDate && <div className="conversation-date">{date === new Date().toLocaleDateString('zh-CN') ? '今天' : date}</div>}
      {turn.user && <Event e={turn.user} turn={turn} canEdit={index === turns.length - 1 && !turn.tools.length && !turn.failures && !turn.user.attachments?.length} />}
      <TurnProcess turn={turn} />
      {turn.answers.map((e, i) => <Event key={e.id || i} e={e} turn={turn} />)}
      <TurnFiles turn={turn} />
      {turn.alerts.map((e, i) => <Event key={e.id || i} e={e} />)}

    </section>;
  });
}

function TurnFiles({ turn }) {
  const w = useWorkbench(), run = w.cur.run, ws = w.session?.workspace;
  if (run?.workspaceId !== ws?.id || run?.workspaceRevision !== ws?.revision) return null;
  const files = turn.tools.filter(e => e.runId === run.id && e.result !== undefined && !e.isError && !e.cancelled && ['workspace_write', 'workspace_edit', 'workspace_append'].includes(e.name)).map(e => e.args?.path || e.args?.file).filter(Boolean);
  return files.length ? <div className="turn-files">{[...new Set(files)].map(path => <Button key={path} size="2" variant="soft" color="gray" onClick={() => w.tabs.openDocument(path)}><Icon n="file" />{path.split(/[\\/]/).pop()}<Icon n="external" size={12} /></Button>)}</div> : null;
}

function TurnProcess({ turn }) {
  const { cur } = useWorkbench();
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
  if (!turn.process.length && !turn.subagents.length) return turn.active ? <div className="turn-meta" role="status"><span className="tool-state run"><Spinner size="1" /></span><span className="turn-process-label" title={label}>{label}</span></div> : null;
  const header = <><span className={'tool-state ' + (turn.active ? 'run' : turn.failures ? 'err' : 'ok')}>{turn.active ? <Spinner size="1" /> : <Icon n={turn.failures ? 'info' : 'check'} size={13} />}</span><span className="turn-process-label" title={label}>{label}</span>{turn.active && elapsed && <span className="turn-process-elapsed">{elapsed}</span>}{count && <span className="tool-count" title={count}>{count}</span>}</>;
  const content = <div className="turn-process-items">{turn.process.map((e, i) => e.type === 'tool' ? <ToolEvent key={e.itemId || i} e={e} /> : e.type === 'reasoning' ? <Reasoning key={e.id} event={e} /> : e.type === 'assistant' ? <div className="process-message" key={e.id || i}><Markdown text={e.content} /></div> : <Event key={e.id || i} e={e} />)}<TurnSubagents agents={turn.subagents} /></div>;
  // Keep the same parent as a short live turn grows, preserving open tool details.
  return <details className={'turn-process tool-group' + (!presentation.foldable ? ' turn-process-inline' : '')} open={!presentation.foldable || open}>
    <summary hidden={!presentation.foldable} aria-label="执行过程" onClick={e => { e.preventDefault(); setExpanded(!open); }}>{header}<Icon n={open ? 'chevup' : 'chevdown'} size={12} /></summary>
    <div className="turn-meta" hidden={presentation.foldable} aria-label="执行状态">{header}</div>
    {(!presentation.foldable || open) && content}
  </details>;
}

function ToolEvent({ e }) {
  const [open, setOpen] = useState(false);
  const st = e.result === undefined ? 'run' : e.isError ? 'err' : e.cancelled ? 'cancelled' : 'ok';
  const format = value => typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const duration = e.ms == null ? '' : e.ms < 1000 ? `${e.ms} ms` : `${(e.ms / 1000).toFixed(1)} s`;
  const presentation = toolPresentation(e);
  return <div className={'tool' + (open ? ' expanded' : '')}>
    <button className="tool-head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
      <span className={'tool-state ' + st}>{st === 'run' ? <Spinner size="1" /> : <Icon n={st === 'err' ? 'info' : st === 'cancelled' ? 'stop' : 'check'} size={13} />}</span>
      <span className="tool-name" title={e.name}>{presentation.title}</span>
      <span className="tool-arg mono" title={presentation.detail}>{presentation.detail ? '· ' + presentation.detail : ''}</span>
      <span className="tool-duration">{duration}</span>
      <Icon n={open ? 'chevup' : 'chevdown'} size={11} />
    </button>
    {open && <div className="tool-body"><div className="tool-section-label">{e.name}<span>{duration}</span></div><ToolPayload label="输入" text={format(e.args || {})} /><ToolPayload label="输出" text={e.result === undefined ? '执行中…' : format(e.result)} /></div>}
  </div>;
}

function ToolPayload({ label, text }) {
  const { toast } = useWorkbench();
  return <section className="tool-payload" aria-label={'工具' + label}><div className="tool-section-label">{label}<ActionIcon icon="copy" size="1" variant="ghost" color="gray" title={'复制工具' + label} onClick={async () => { try { await navigator.clipboard.writeText(text); toast('已复制', 'ok'); } catch { toast('复制失败', 'err'); } }} /></div><pre tabIndex={0}>{text}</pre></section>;
}

function AssistantMessage({ e, turn, copy }) {
  const w = useWorkbench(), rating = w.cur.ratings?.[e.id] || '';
  const usage = turn?.usage || null, tokens = usage ? (usage.prompt || 0) + (usage.completion || 0) : 0;
  const complete = e.phase === 'final_answer' && !!turn?.endedAt;
  const time = complete ? new Date(turn.endedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '';
  const final = e.phase === 'final_answer';
  return <article aria-label="模型回复" className={'msg assistant' + (final ? '' : ' commentary') + (e.phase === 'streaming' ? ' is-streaming' : '')}>
    <div className="bubble"><Markdown text={e.content} /></div>
    {final && <div className="message-foot">
      <ActionIcon icon="copy" size="1" variant="ghost" color="gray" onClick={copy} title="复制回复" aria-label="复制回复" />
      <ActionIcon icon="thumbup" size="1" variant="ghost" color={rating === 'up' ? 'tomato' : 'gray'} onClick={() => w.rate(e.id, 'up')} title={rating === 'up' ? '取消“有帮助”' : '标记为有帮助'} aria-label="有帮助" aria-pressed={rating === 'up'} />
      <ActionIcon icon="thumbdown" size="1" variant="ghost" color={rating === 'down' ? 'tomato' : 'gray'} onClick={() => w.rate(e.id, 'down')} title={rating === 'down' ? '取消“没帮助”' : '标记为没帮助'} aria-label="没帮助" aria-pressed={rating === 'down'} />
      <span className="spacer" />
      {tokens > 0 && <Text size="1" color="gray">用量 {fmtK(tokens)} tok</Text>}
      {time && <Text size="1" color="gray" className="message-time">{time}</Text>}
    </div>}
  </article>;
}
function Event({ e, turn, canEdit = false }) {
  const [open, setOpen] = useState(false);
  const w = useWorkbench(), { toast } = w;
  const copy = async () => { try { await navigator.clipboard.writeText(e.content); toast('已复制', 'ok'); } catch { toast('复制失败', 'err'); } };
  if (e.type === 'user') return <article className="msg user"><div className="user-message"><div className="bubble">{e.content && <div className="user-content">{e.content}</div>}<AttachmentTiles items={e.attachments || e.atts || []} sessionId={w.sid} invoke={w.api.invoke} /></div><div className="message-meta">{e.at && <time dateTime={new Date(e.at).toISOString()}>{new Date(e.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time>}{e.attachments?.length > 0 && <ActionIcon icon="plus" variant="ghost" color="gray" onClick={() => w.addAtt(e.attachments.map(a => ({ ...a, key: a.id || a.path || a.file })))} title="重新使用附件" />}{e.content && <ActionIcon icon="copy" variant="ghost" color="gray" onClick={copy} title="复制消息" />}{canEdit && e.content && <ActionIcon icon="edit" variant="ghost" color="gray" onClick={() => w.startEdit(turn)} title="编辑并重新发送" />}</div></div></article>;
  if (e.type === 'assistant') return e.content ? <AssistantMessage e={e} turn={turn} copy={copy} /> : null;
  if (e.type === 'error') return <Callout.Root size="1" color="red"><Callout.Icon><Icon n="info" size={14} /></Callout.Icon><Callout.Text>{e.content}</Callout.Text></Callout.Root>;
  if (e.type === 'note') return <Callout.Root size="1" color="gray"><Callout.Icon><Icon n="info" size={14} /></Callout.Icon><Callout.Text>{e.content}</Callout.Text></Callout.Root>;
  if (e.type === 'compact') {
    const label = e.stage === 'pruned' ? `收起 ${e.pruned} 个旧工具结果` : `${e.reason === 'auto' ? '自动' : ''}压缩 ${e.summarized || ''} 条较早消息`;
    return <div className="compact-line">
      <Separator size="4" style={{ flex: 1 }} />
      <button className="compact-trigger" disabled={!e.summary} onClick={() => setOpen(o => !o)} aria-expanded={open} title={`${label} · ${fmtK(e.before)} → ${fmtK(e.after)}`}>
        <Icon n="layers" size={11} /><Text size="1" color="gray">上下文已压缩</Text>
        {e.summary && <Icon n={open ? 'chevup' : 'chevdown'} size={10} />}
      </button>
      <Separator size="4" style={{ flex: 1 }} />
      {open && <div className="compact-body"><Text size="1" color="gray">{label} · {fmtK(e.before)} → {fmtK(e.after)}</Text><Markdown text={e.summary} /></div>}
    </div>;
  }
  return null;
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

function CtxMeter() {
  const { cur } = useWorkbench();
  const [open, setOpen] = useState(false);
  const ctx = cur.ctx;
  const pct = Math.min(1, ctx?.pct || 0);
  const at = ctx?.trigger && ctx?.limit ? ctx.trigger / ctx.limit : 0.85;
  const parts = ctx?.parts || {};
  const stroke = pct >= at ? 'var(--red-9)' : pct >= at - 0.2 ? 'var(--amber-9)' : 'var(--gray-8)';
  const R = 6.5, C = 2 * Math.PI * R;
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger><Button size="2" variant="soft" color="gray" title={`上下文用量 ${fmtK(ctx?.used)} / ${fmtK(ctx?.limit)}`} aria-label="上下文用量">
      <svg width="16" height="16" viewBox="0 0 16 16" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="8" cy="8" r={R} fill="none" stroke="var(--gray-a5)" strokeWidth="2.2" />
        <circle cx="8" cy="8" r={R} fill="none" stroke={stroke} strokeWidth="2.2" strokeLinecap="round" strokeDasharray={`${C * pct} ${C}`} />
      </svg>
    </Button></Popover.Trigger>
    <Popover.Content width="360px" align="end" aria-label="上下文用量" data-overlay>
      <Flex justify="between" mb="2">
        <Text size="1" weight="bold">{fmtK(ctx?.used)} / {fmtK(ctx?.limit)}</Text>
        <Text size="1" color="gray">{Math.round(pct * 100)}%</Text>
      </Flex>
      <div className="ctx-bar">{CTX_PARTS.map(([k]) => parts[k] > 0 && <i key={k} className={'sw-' + k} style={{ flex: parts[k] }} />)}</div>
      <div className="ctx-rows">{CTX_PARTS.map(([k, l]) => <Flex key={k} justify="between" align="center" style={{ opacity: parts[k] ? 1 : .45 }}>
        <Text size="1"><i className={'sw sw-' + k} />{l}</Text><Text size="1" color="gray">{fmtK(parts[k] || 0)}</Text>
      </Flex>)}</div>
      <Text as="div" size="1" color="gray" mt="2">{Math.round(at * 100)}% 时自动压缩{ctx?.compressions ? ` · 已压缩 ${ctx.compressions} 次` : ''}{ctx?.inferred ? ' · 窗口按模型推断' : ''}</Text>
    </Popover.Content>
  </Popover.Root>;
}
