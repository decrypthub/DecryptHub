import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Flex, Text, Dialog, TextArea, Spinner } from '@radix-ui/themes';
import { Button, ActionIcon, Icon, Markdown } from './kit.jsx';
import { useWorkbench } from './bus.jsx';
const COMMAND_CHROME = {
  goal: ['添加', '目标', 'target'], plan: ['添加', '计划', 'report'], agent: ['添加', '子代理', 'team'],
  compact: ['指令', '压缩', 'layers'], permission: ['指令', '权限', 'shield-check'],
  agents: ['指令', '子代理列表', 'team'], status: ['指令', '状态', 'info'], stop: ['指令', '停止', 'stop'],
  new: ['指令', '新建对话', 'plus'], help: ['指令', '帮助', 'info'],
  skill: ['技能与记忆', '创建技能', 'sparkles'], skills: ['技能与记忆', '技能', 'sparkles'],
  memory: ['技能与记忆', '创建记忆', 'report'], memories: ['技能与记忆', '记忆', 'report'],
  automation: ['更多', '自动化', 'clock'], mcp: ['更多', '插件', 'tool'], init: ['更多', '项目说明', 'file'],
};
export function commandMenuItems(items) {
  const groups = ['添加', '指令', '技能', '技能与记忆', '更多'];
  const group = item => item.kind === 'skill' ? '技能' : COMMAND_CHROME[item.name]?.[0] || '指令';
  return items.slice().sort((a, b) => groups.indexOf(group(a)) - groups.indexOf(group(b)));
}
export function CommandMenu({ items, selected, choose, anchor, id, onHighlight, onDismiss, ariaLabel = '输入框命令' }) {
  const [rect, setRect] = useState(null);
  useEffect(() => {
    const update = () => { const el = anchor.current?.closest('.composer'); if (el) setRect(el.getBoundingClientRect()); };
    update(); window.addEventListener('resize', update); const obs = new ResizeObserver(update); if (anchor.current) obs.observe(anchor.current);
    return () => { obs.disconnect(); window.removeEventListener('resize', update); };
  }, [anchor]);
  useEffect(() => { document.getElementById(id + '-' + selected)?.scrollIntoView({ block: 'nearest' }); }, [selected, id]);
  useEffect(() => {
    if (!onDismiss) return;
    const dismiss = event => { if (!event.target.closest?.('.command-menu') && !anchor.current?.closest('.composer')?.contains(event.target)) onDismiss(); };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [onDismiss, anchor]);
  if (!rect || !items.length) return null;
  const sections = [...new Set(items.map(c => c.token ? ariaLabel : c.kind === 'skill' ? '技能' : COMMAND_CHROME[c.name]?.[0] || '指令'))];
  return createPortal(<div className="command-menu" data-overlay style={{ left: rect.left, bottom: innerHeight - rect.top + 8, width: rect.width, maxHeight: Math.max(96, Math.min(440, rect.top - 24)) }}>
    <div role="listbox" aria-label={ariaLabel} id={id} className="command-options">{sections.map(section => <div className="command-group" role="group" aria-label={section} key={section}>
      <div className="command-group-label">{section}</div>
      {items.map((c, i) => {
        const [group, label, icon] = c.token ? [ariaLabel, c.label, 'chat'] : c.kind === 'skill' ? ['技能', c.label, 'sparkles'] : COMMAND_CHROME[c.name] || ['指令', c.label, 'code'];
        if (group !== section) return null;
        return <button type="button" role="option" aria-selected={selected === i} id={id + '-' + i} className={'command-option' + (selected === i ? ' selected' : '')} key={c.name} onPointerMove={() => onHighlight?.(i)} onMouseDown={e => e.preventDefault()} onClick={() => choose(c)}>
          <Icon n={icon} size={18} /><span className="command-option-label">{label}</span>{c.kind !== 'skill' && <span className="command-option-name">{c.token ?? c.name}</span>}<span className="command-option-description" title={c.description}>{c.description}</span>
        </button>;
      })}
    </div>)}</div>
  </div>, document.querySelector('.radix-themes') || document.body);
}
// 对话流中的命令状态行。运行中的两条语义必须分开：
//   · 一般命令 → ✕ 只是「收起这条提示」，命令还在跑；
//   · 压缩 → ✕ 是「取消这次压缩」，真的打断摘要请求（sidecar 的 agent-compress-cancel）。
// 之前两者共用一个「收起提示」，界面上看起来能取消，其实只会把提示藏起来。
export function CommandFeedback() {
  const w = useWorkbench(), value = w.commandFeedback;
  if (!value) return null;
  if (value.name === 'compact' && ['success', 'done'].includes(value.state) && w.cur.events.some(e => e.type === 'compact' && e.at >= value.at)) return null;
  const busy = value.state === 'running';
  // 压缩在跑时以 agent 真实状态为准：命令已经返回但压缩还没收尾，不能显示成「已完成」。
  const compressing = busy && value.name === 'compact';
  const cancel = compressing ? () => w.cancelCompact() : undefined;
  return <div className={'command-row ' + value.state} role={value.state === 'error' ? 'alert' : 'status'}>
    <span className="command-row-icon">{busy ? <Spinner size="1" /> : <Icon n={value.state === 'error' ? 'info' : 'check'} size={14} />}</span>
    <span className="command-row-name">/{value.name}</span><span className="command-separator">·</span><span className="command-row-summary">{value.text}</span>
    <ActionIcon icon="x" size="1" variant="soft" color="gray"
      title={compressing ? '取消这次压缩' : busy ? '收起提示（命令仍在执行）' : '收起命令提示'}
      aria-label={compressing ? '取消这次压缩' : '收起命令提示'}
      onClick={cancel || w.clearCommandFeedback} />
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
        <div className="extension-list">{items.map(item => <button className="project-choice" key={(item.source || item.scope) + item.name} onClick={() => { const sid = w.sid; w.api.invoke('extension-read', { sessionId: sid, kind: w.extensionBrowser, name: item.name, scope: item.scope, source: item.source }).then(value => { if (w.isCurrentSession(sid)) setSelected(value); }).catch(e => { if (w.isCurrentSession(sid)) setError(e.message); }); }}><Icon n="file" /><span>{item.name}<small>{{ session: '当前会话', project: '当前项目', user: '用户' }[item.scope]} · {item.description}</small></span></button>)}</div>
        {!items.length && <Text as="p" size="2" color="gray">暂无内容。使用 /{w.extensionBrowser === 'skill' ? 'skill' : 'memory'} 创建。</Text>}
        {selected && <div className="extension-preview"><Markdown text={selected.content} /></div>}
        {error && <Text as="p" size="2" color="red" role="alert">{error}</Text>}
        <Flex justify="end" mt="4"><Dialog.Close><Button size="2" variant="soft" color="gray">关闭</Button></Dialog.Close></Flex>
      </Dialog.Content>
    </Dialog.Root>
  </>;
}
