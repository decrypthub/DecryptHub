// 对话区：顶栏（会话身份 + 权限/模型/上下文）、消息流、输入坞。
import React, { useEffect, useRef, useState } from 'react';
import { Box, Flex, Text, Badge, Card, Callout, Spinner, TextArea, Separator, Popover } from '@radix-ui/themes';
import { useWorkbench } from './bus.jsx';
import { Button, ActionIcon, Icon, Markdown, Dropdown } from './kit.jsx';
import { fmtK, hostOf, sessionLabel } from './state.js';
import { native } from './transport.js';
import { WorkspaceBar, PermissionPicker, PendingActions } from './workspace.jsx';
import { AttachmentTiles } from './attachments.jsx';
import { conversationTurns, toolPresentation, elapsedLabel } from './conversation.js';
import { commandMatches } from './commands.js';
import { CommandMenu, HarnessStatus, CommandFeedback, CommandDialogs } from './harness.jsx';
import { handleWindowDrag } from './window-drag.js';
import { TodoStrip } from './plan.jsx';
import { Reasoning } from './reasoning.jsx';

const CTX_PARTS = [['system', '系统提示'], ['tools', '工具定义'], ['summary', '压缩摘要'], ['history', '对话'], ['attachments', '附件'], ['toolResults', '工具结果']];

export function ChatStage({ railOpen, onExpandRail }) {
  const w = useWorkbench();
  const fileRef = useRef(null), [dragging, setDragging] = useState(false);
  const [commandIndex, setCommandIndex] = useState(0), [commandDismissed, setCommandDismissed] = useState(false);
  const { cur, session, input, setInput, send, atts, rmAtt, settings, pickModel, inv, refs } = w;
  const host = hostOf(cur.url);
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


  return <div className={'chat' + (!cur.events.length ? ' is-empty' : '')}>
    <header className="stage-head" data-window-drag-region onMouseDown={e => handleWindowDrag(e, native)}>
      {!railOpen && <ActionIcon icon="sidebar" variant="soft" color="gray" onClick={onExpandRail} title="展开会话列表" />}
      <div className="stage-identity">
        <strong className="ellipsis">{sessionLabel(session || {})}</strong>
        {host && <span className="ellipsis">{host}</span>}
      </div>
      <Flex align="center" gap="2" style={{ minWidth: 0 }}>
        {cur.mode === 'full-access' && <Badge size="1" variant="soft" color="red">完全访问权限</Badge>}
      </Flex>
      <Box flexGrow="1" />
      {w.conn !== 'connected' && <span className="tb-reconnecting" role="status"><Spinner size="1" />连接中…</span>}
    </header>

    {!keyOk && <div className="banner amber">
      <Icon n="info" size={13} />
      <Text size="1">尚未配置模型</Text>
      <Button size="2" variant="ghost" onClick={() => w.setView('settings')}>配置<Icon n="go" size={16} /></Button>
    </div>}
    {cur.run?.status === 'interrupted' && <div className="banner amber"><Icon n="info" /><Text size="1">上次任务已中断。已有改动已保留，可以检查后继续。</Text></div>}
    {cur.run?.status === 'needs_attention' && <div className="banner amber"><Icon n="info" /><Text size="1">自动化需要权限或补充信息，请在此对话中继续处理。</Text></div>}

    <TodoStrip key={w.sid} />

    <div className="msgs" ref={refs.chatRef}>
      {cur.events.length === 0
        ? <Welcome onPick={t => { setInput(t); setTimeout(() => refs.inputRef.current?.focus(), 30); }} onOpen={() => { w.setSide('browser'); w.setSideOpen(true); setTimeout(() => { refs.urlRef.current?.focus(); refs.urlRef.current?.select(); }, 60); }} running={cur.status.running} />
        : <div className="msgs-in">
            <MessageStream events={cur.events} />
          </div>}
    </div>

    <div className="composer-wrap">
      <CommandFeedback />
      <HarnessStatus />
      {!!cur.queued && <Flex align="center" gap="2" mb="2"><Text size="1" color="gray">下一轮队列：{cur.queued} 项</Text>{!cur.agentRunning && <Button size="1" variant="ghost" color="gray" onClick={() => inv('agent-queue-resume').then(r => !r.ok && w.toast(r.error, 'err')).catch(e => w.toast(e.message, 'err'))}>继续队列</Button>}<Button size="1" variant="ghost" color="gray" onClick={() => inv('agent-queue-clear')}>清空队列</Button></Flex>}
      <PendingActions />
      <WorkspaceBar />
      <CommandDialogs />
      <Card className={'composer' + (dragging ? ' drag-over' : '')} size="2"
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
          placeholder={cur.agentRunning ? '补充要求，或输入 / 查看命令…' : '输入任务，粘贴图片，或输入 / 查看命令…'} />
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
          {(cur.agentRunning || cur.subagents?.some(a => a.status === 'running')) && <ActionIcon icon="stop" variant="soft" color="gray" onClick={() => inv('agent-interrupt')} title="停止响应" />}
          <ActionIcon icon="send" className="send-button" variant="solid" onClick={() => send(false)}
            disabled={w.sending || w.uploading || (!input.trim() && !atts.length)}
            title={cur.agentRunning ? '加入下一轮队列（Enter）' : '发送（Enter）'} />
        </div>
      </Card>
    </div>
  </div>;
}

function MessageStream({ events }) {
  const w = useWorkbench(), turns = conversationTurns(events, w.cur.run, w.cur.agentRunning);
  let lastDate = '';
  return turns.map(turn => {
    const date = turn.user?.at ? new Date(turn.user.at).toLocaleDateString('zh-CN') : '';
    const showDate = date && date !== lastDate; if (date) lastDate = date;
    return <section className="conversation-turn" key={turn.id} data-turn-id={turn.id}>
      {showDate && <div className="conversation-date">{date === new Date().toLocaleDateString('zh-CN') ? '今天' : date}</div>}
      {turn.user && <Event e={turn.user} />}
      <TurnProcess turn={turn} />
      {turn.answers.map((e, i) => <Event key={e.id || i} e={e} />)}
      {turn.alerts.map((e, i) => <Event key={e.id || i} e={e} />)}

    </section>;
  });
}

function TurnProcess({ turn }) {
  const { cur } = useWorkbench();
  const [expanded, setExpanded] = useState(null), [now, setNow] = useState(Date.now());
  const open = expanded ?? turn.active, hasReasoning = turn.process.some(e => e.type === 'reasoning');
  useEffect(() => { if (!turn.active) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [turn.active]);
  const currentTool = turn.tools.findLast(t => t.result === undefined);
  const elapsed = turn.startedAt ? elapsedLabel((turn.active ? now : turn.endedAt || turn.startedAt) - turn.startedAt) : '';
  const label = turn.status === 'waiting_approval' ? '等待批准' : turn.status === 'waiting_user' ? '等待你的回答' : turn.active ? currentTool ? toolPresentation(currentTool).title : cur.thinking ? '正在思考' : '正在回复' : turn.status === 'cancelled' ? '已停止' : turn.status === 'failed' ? '执行未完成' : turn.status === 'needs_attention' ? '需要你处理' : turn.status === 'stopped' ? '已暂停' : elapsed ? '用时 ' + elapsed : '执行过程';
  if (!turn.process.length) return turn.active || elapsed ? <div className="turn-meta" role={turn.active ? 'status' : undefined}>{turn.active && <Spinner size="1" />}<span>{label}</span></div> : null;
  return <details className="turn-process tool-group" open={open}>
    <summary aria-label="执行过程" onClick={e => { e.preventDefault(); setExpanded(!open); }}><span className={'tool-state ' + (turn.active ? 'run' : turn.failures ? 'err' : 'ok')}>{turn.active ? <Spinner size="1" /> : <Icon n={turn.failures ? 'info' : 'check'} size={13} />}</span><span>{label}</span>{turn.active && elapsed && <span>{elapsed}</span>}<span className="tool-count">{hasReasoning ? '思考过程' : ''}{hasReasoning && turn.tools.length ? ' · ' : ''}{turn.tools.length ? `${turn.tools.length} 项操作` : ''}{turn.failures ? ` · ${turn.failures} 项失败` : ''}</span><Icon n={open ? 'chevup' : 'chevdown'} size={12} /></summary>
    {open && <div className="turn-process-items">{turn.process.map((e, i) => e.type === 'tool' ? <ToolEvent key={e.itemId || i} e={e} /> : e.type === 'reasoning' ? <Reasoning key={e.id} event={e} /> : e.type === 'assistant' ? <div className="process-message" key={e.id || i}><Markdown text={e.content} /></div> : <Event key={e.id || i} e={e} />)}</div>}
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
      <span className="tool-arg mono">{presentation.detail}</span>
      <span className="tool-duration">{duration}</span>
      <Icon n={open ? 'chevup' : 'chevdown'} size={11} />
    </button>
    {open && <div className="tool-body"><div className="tool-section-label">{e.name}<span>{duration}</span></div><div className="tool-section-label">输入</div><pre>{format(e.args || {})}</pre><div className="tool-section-label">输出</div><pre>{e.result === undefined ? '执行中…' : format(e.result)}</pre></div>}
  </div>;
}

function Event({ e }) {
  const [open, setOpen] = useState(false);
  const w = useWorkbench(), { toast } = w;
  const copy = async () => { try { await navigator.clipboard.writeText(e.content); toast('已复制', 'ok'); } catch { toast('复制失败', 'err'); } };
  if (e.type === 'user') return <article className="msg user"><div className="user-message"><div className="bubble">{e.content && <div className="user-content">{e.content}</div>}<AttachmentTiles items={e.attachments || e.atts || []} sessionId={w.sid} invoke={w.api.invoke} /></div><div className="message-meta">{e.at && <time dateTime={new Date(e.at).toISOString()}>{new Date(e.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time>}{e.attachments?.length > 0 && <ActionIcon icon="plus" variant="ghost" color="gray" onClick={() => w.addAtt(e.attachments.map(a => ({ ...a, key: a.id || a.path || a.file })))} title="重新使用附件" />}{e.content && <ActionIcon icon="copy" variant="ghost" color="gray" onClick={copy} title="复制消息" />}</div></div></article>;
  if (e.type === 'assistant') return e.content ? <article className={'msg assistant' + (e.phase === 'streaming' ? ' is-streaming' : '')}><div className="bubble"><Markdown text={e.content} /><div className="message-actions"><ActionIcon icon="copy" variant="ghost" color="gray" onClick={copy} title="复制回复" /></div></div></article> : null;
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
      <p className="welcome-hint">可以选择文件夹处理项目，也可以直接开始。文件与代码产出会保存在当前工作区。</p>
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
