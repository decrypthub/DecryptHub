import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Box, Flex, Text, Badge, Popover, Dialog, TextArea, Spinner } from '@radix-ui/themes';
import { Button, ActionIcon, Icon, Markdown } from './kit.jsx';
import { useWorkbench } from './bus.jsx';
export function CommandMenu({ items, selected, choose, anchor, id }) {
  const [rect, setRect] = useState(null);
  useEffect(() => {
    const update = () => { const el = anchor.current?.closest('.composer'); if (el) setRect(el.getBoundingClientRect()); };
    update(); window.addEventListener('resize', update); const obs = new ResizeObserver(update); if (anchor.current) obs.observe(anchor.current);
    return () => { obs.disconnect(); window.removeEventListener('resize', update); };
  }, [anchor]);
  useEffect(() => { document.getElementById(id + '-' + selected)?.scrollIntoView({ block: 'nearest' }); }, [selected, id]);
  if (!rect || !items.length) return null;
  return createPortal(<div className="command-menu" data-overlay style={{ left: rect.left, bottom: innerHeight - rect.top + 8, width: Math.min(rect.width, 640), maxHeight: Math.max(100, Math.min(300, rect.top - 24)) }}>
    <div className="command-menu-label">命令 <span>↑ ↓ 选择 · Tab 补全 · Enter 执行 · Esc 关闭</span></div>
    <div role="listbox" aria-label="输入框命令" id={id} className="command-options">{items.map((c, i) => <button type="button" role="option" aria-selected={selected === i} id={id + '-' + i} className={'command-option' + (selected === i ? ' selected' : '')} key={c.name} onMouseDown={e => e.preventDefault()} onClick={() => choose(c)}>
      <code>/{c.name}</code><span title={c.description}>{c.label} · {c.description}</span>
    </button>)}</div>
  </div>, document.querySelector('.radix-themes') || document.body);
}
export function HarnessStatus() {
  const { cur, inv, toast, setInput, refs } = useWorkbench(), [showAgents, setShowAgents] = useState(false), [result, setResult] = useState(null);
  const goal = cur.goal, agents = cur.subagents || [], running = agents.filter(a => a.status === 'running').length;
  const action = async name => { const r = await inv('goal-action', { action: name }).catch(e => ({ ok: false, error: e.message })); if (!r.ok) toast(r.error, 'warn'); };
  const labels = { active: '进行中', paused: '已暂停', complete: '已完成', needs_attention: '需要处理', running: '研究中', completed: '已完成', failed: '失败', interrupted: '已中断', cancelled: '已取消', limited: '达到上限' };
  return <>
    {goal && <div className="harness-goal"><Icon n="target" size={16} /><div><Flex align="center" gap="2"><strong className="ellipsis" title={goal.objective}>{goal.objective}</strong><Badge size="1" color={goal.status === 'complete' ? 'green' : goal.status === 'active' ? undefined : 'gray'}>{labels[goal.status]}</Badge></Flex>{goal.summary && <small title={goal.summary}>{goal.summary}</small>}</div>
      {goal.status === 'active' ? <Button size="1" variant="soft" color="gray" onClick={() => action('pause')}>暂停</Button> : goal.status !== 'complete' && <Button size="1" variant="soft" color="gray" disabled={cur.agentRunning} onClick={() => action('resume')}>继续</Button>}
      <ActionIcon icon="x" size="1" variant="soft" color="gray" onClick={() => action('clear')} title="结束并收起目标" />
    </div>}
    {!!agents.length && <div className="harness-agents"><button className="agents-summary" onClick={() => setShowAgents(!showAgents)} aria-expanded={showAgents}><Icon n="layers" size={14} />研究子代理 <span>{running ? `${running} 项运行中` : `${agents.length} 项任务`}</span><Icon n="chevdown" size={12} /></button>
      {showAgents && agents.slice().reverse().map(a => <div className="subagent-row" key={a.id}><Popover.Root onOpenChange={open => { if (open) { setResult(null); inv('subagent-result', { id: a.id }).then(setResult).catch(e => toast(e.message, 'err')); } }}><Popover.Trigger><Button size="1" variant="ghost" color="gray" className="subagent-title"><span className="ellipsis">{a.title}</span></Button></Popover.Trigger><Popover.Content width="480px" data-overlay><Text size="2" weight="medium">{a.title}</Text><Text as="p" size="1" color="gray">独立上下文 · 只读工作区 · {labels[a.status]}</Text><pre className="subagent-result">{result?.id === a.id ? result.summary || '正在研究…' : '加载中…'}</pre></Popover.Content></Popover.Root><Badge color="gray" size="1">{labels[a.status]}</Badge>{a.status === 'running' && <ActionIcon icon="stop" size="1" variant="soft" color="gray" onClick={() => inv('subagent-cancel', { id: a.id })} title="取消子代理" />}</div>)}
    </div>}
  </>;
}

export function CommandFeedback() {
  const w = useWorkbench(), value = w.commandFeedback;
  if (!value) return null;
  return <div className={'command-feedback ' + value.state} role={value.state === 'error' ? 'alert' : 'status'}>
    {value.state === 'running' ? <Spinner size="1" /> : <Icon n={value.state === 'error' ? 'info' : 'check'} size={15} />}
    <span>{value.text}</span><ActionIcon icon="x" size="1" variant="soft" color="gray" title="收起命令提示" onClick={w.clearCommandFeedback} />
  </div>;
}
export function CommandDialogs() {
  const w = useWorkbench(), form = w.commandForm;
  const [text, setText] = useState(''), [busy, setBusy] = useState(false), [items, setItems] = useState([]), [selected, setSelected] = useState(null), [error, setError] = useState('');
  const titles = { goal: '设置目标', skill: '创建或使用技能', memory: '创建记忆', agent: '创建研究子代理' };
  useEffect(() => { setText(''); setError(''); }, [form]);
  useEffect(() => {
    if (!w.extensionBrowser) return;
    let live = true; setItems([]); setSelected(null); setError('');
    w.inv('extensions-list', { kind: w.extensionBrowser }).then(v => live && setItems(v)).catch(e => live && setError(e.message));
    return () => { live = false; };
  }, [w.extensionBrowser, w.sid]);
  return <>
    <Dialog.Root open={!!form} onOpenChange={value => { if (!value && !busy) w.setCommandForm(null); }}>
      <Dialog.Content maxWidth="540px" data-overlay><Dialog.Title>{titles[form?.name] || '命令'}</Dialog.Title>
        <Dialog.Description size="2" color="gray">{form?.name === 'goal' ? '描述明确的完成条件。Agent 会持续推进，遇到权限或缺少信息时等待你处理。' : '写清楚用途和要求，Agent 会通过对应工具执行并返回结果。'}</Dialog.Description>
        <form onSubmit={async e => { e.preventDefault(); if (!text.trim() || form.sessionId !== w.sid) return; setBusy(true); try { if (await w.send(false, '/' + form.name + ' ' + text.trim())) w.setCommandForm(null); } catch (e) { setError(e.message); } finally { setBusy(false); } }}>
          <TextArea mt="4" rows={5} value={text} onChange={e => setText(e.target.value)} autoFocus aria-label={titles[form?.name] || '命令内容'} placeholder={form?.name === 'goal' ? '要完成什么，怎样判断已完成？' : '描述用途、规则或要保存的内容…'} />
          {form?.sessionId !== w.sid && <Text as="p" size="2" color="red">已切换会话，请关闭后重新执行命令。</Text>}
          {error && <Text as="p" size="2" color="red" role="alert">{error}</Text>}
          <Flex justify="end" gap="2" mt="4"><Button type="button" variant="soft" color="gray" onClick={() => w.setCommandForm(null)} disabled={busy}>取消</Button><Button type="submit" disabled={!text.trim() || form?.sessionId !== w.sid} loading={busy}>执行</Button></Flex>
        </form>
      </Dialog.Content>
    </Dialog.Root>
    <Dialog.Root open={!!w.extensionBrowser} onOpenChange={value => { if (!value) w.setExtensionBrowser(null); }}>
      <Dialog.Content maxWidth="680px" data-overlay><Dialog.Title>{w.extensionBrowser === 'skill' ? '技能' : '记忆'}</Dialog.Title><Dialog.Description size="2" color="gray">当前会话、项目及用户范围中保存的内容。</Dialog.Description>
        <div className="extension-list">{items.map(item => <button className="project-choice" key={item.scope + item.name} onClick={() => { const sid = w.sid; w.api.invoke('extension-read', { sessionId: sid, kind: w.extensionBrowser, name: item.name, scope: item.scope }).then(value => { if (w.isCurrentSession(sid)) setSelected(value); }).catch(e => { if (w.isCurrentSession(sid)) setError(e.message); }); }}><Icon n="file" /><span>{item.name}<small>{{ session: '当前会话', project: '当前项目', user: '用户' }[item.scope]} · {item.description}</small></span></button>)}</div>
        {!items.length && <Text as="p" size="2" color="gray">暂无内容。使用 /{w.extensionBrowser === 'skill' ? 'skill' : 'memory'} 创建。</Text>}
        {selected && <div className="extension-preview"><Markdown text={selected.content} /></div>}
        {error && <Text as="p" size="2" color="red" role="alert">{error}</Text>}
        <Flex justify="end" mt="4"><Dialog.Close><Button size="2" variant="soft" color="gray">关闭</Button></Dialog.Close></Flex>
      </Dialog.Content>
    </Dialog.Root>
  </>;
}
