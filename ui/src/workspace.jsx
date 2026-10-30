import React, { useEffect, useState } from 'react';
import { Box, Flex, Text, Badge, Card, TextArea, Tabs, DropdownMenu } from '@radix-ui/themes';
import { useWorkbench } from './bus.jsx';
import { Button, Icon, askConfirm, EmptyState } from './kit.jsx';

const PERMISSIONS = [
  { id: 'manual', label: '请求批准', icon: 'key', description: '工作区内读写；额外执行和联网权限由你确认' },
  { id: 'auto', label: '自动批准', icon: 'clock', description: '隔离范围内按规则批准；需要额外权限时询问' },
  { id: 'full-access', label: '完全访问权限', icon: 'info', description: '文件、命令、浏览器及已启用工具直接执行' },
  { id: 'read-only', label: '只读查看', icon: 'file', description: '仅查看文件和页面，不运行代码或修改内容' },
];
export function PermissionPicker() {
  const w = useWorkbench(), [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const selected = w.cur.mode === 'standard' ? w.cur.review || 'manual' : w.cur.mode;
  useEffect(() => setOpen(false), [w.sid]);
  async function change(id) {
    const sid = w.sid; if (id === selected) return;
    if (id === 'full-access' && !await askConfirm('Agent 将使用当前系统用户权限执行命令、访问文件和网络、操控浏览器及调用已启用的外部工具，不再逐次请求批准。任务运行中切换会立即生效，正在等待的批准会直接放行；此选择仅对当前会话、本次应用运行有效。', { ok: '启用完全访问权限', danger: true })) return;
    if (!w.isCurrentSession(sid)) return;
    setBusy(true);
    try { await w.api.invoke('session-set-mode', { sessionId: sid, mode: ['manual', 'auto'].includes(id) ? 'standard' : id, review: id === 'auto' ? 'auto' : 'manual' }); }
    catch (e) { w.toast(e.message, 'err'); } finally { setBusy(false); }
  }
  return <DropdownMenu.Root open={open} onOpenChange={setOpen}><DropdownMenu.Trigger><Button size="2" variant="soft" color={w.cur.mode === 'full-access' ? 'red' : 'gray'} disabled={busy} aria-label="选择权限" title={w.cur.agentRunning ? '任务运行中也可切换权限，下一次工具调用即生效' : '选择权限'}><Icon n={PERMISSIONS.find(p => p.id === selected)?.icon || 'key'} /><span className="perm-label">{PERMISSIONS.find(p => p.id === selected)?.label || '请求批准'}</span><Icon n="chevdown" /></Button></DropdownMenu.Trigger>
    <DropdownMenu.Content align="start" side="top" data-overlay className="permission-menu"><DropdownMenu.Label>如何批准 Agent 操作</DropdownMenu.Label><DropdownMenu.RadioGroup value={selected} onValueChange={change}>{PERMISSIONS.map(p => <DropdownMenu.RadioItem key={p.id} value={p.id} aria-label={p.label} disabled={busy} className="permission-menu-item"><Icon n={p.icon} /><span><strong>{p.label}</strong><small>{p.description}</small></span></DropdownMenu.RadioItem>)}</DropdownMenu.RadioGroup></DropdownMenu.Content>
  </DropdownMenu.Root>;
}
export function PendingActions() {
  const w = useWorkbench(), approvals = w.cur.approvals || [];
  const [answer, setAnswer] = useState(''), [busy, setBusy] = useState('');
  async function reply(req, allow, always = false) {
    setBusy(req.id); try { await w.inv('agent-approval-reply', { id: req.id, allow, always }); } catch (e) { w.toast(e.message, 'err'); } finally { setBusy(''); }
  }
  const question = w.cur.question;
  async function respond(value) { if (!question) return; try { await w.inv('agent-answer', { id: question.id, answer: value }); setAnswer(''); } catch (e) { w.toast(e.message, 'err'); } }
  return <div className="pending-actions">
    {approvals.map(req => <Card size="2" key={req.id} className="approval-card">
      <Flex align="center" justify="between" gap="2"><Text size="2" weight="bold">需要批准操作</Text><Badge size="1" color={req.isolated === false ? 'amber' : 'gray'}>{req.isolated === false ? '未隔离执行' : req.isolated ? '受限执行' : '外部操作'}</Badge></Flex>
      <Text as="div" size="2" mt="2">{req.summary}</Text>
      {req.cwd && <Text as="div" size="1" className="mono" mt="2">工作目录：{req.cwd}</Text>}
      {req.command && <pre className="approval-code">{req.command}</pre>}
      {req.code && <details><summary>查看执行输入</summary><pre className="approval-code">{req.code}</pre></details>}
      {!!req.network?.length && <Text as="div" size="1">联网：{req.network.join('、')}</Text>}
      <Flex gap="2" justify="end" mt="3" wrap="wrap"><Button size="2" variant="soft" color="gray" disabled={!!busy} onClick={() => reply(req, false)}>拒绝</Button>{req.canRemember && <Button size="2" variant="soft" color="gray" disabled={!!busy} onClick={() => reply(req, true, true)}>本对话允许相同动作</Button>}<Button size="2" disabled={!!busy} onClick={() => reply(req, true)}>允许这一次</Button></Flex>
    </Card>)}
    {question && <Card size="2"><Text size="2" weight="bold">{question.question}</Text>{question.detail && <Text as="div" size="1" color="gray" mt="2">{question.detail}</Text>}<Flex gap="2" wrap="wrap" mt="3">{(question.options || []).map(option => <Button size="2" key={option} variant="soft" color="gray" onClick={() => respond(option)}>{option}</Button>)}</Flex><TextArea size="2" mt="2" value={answer} onChange={e => setAnswer(e.target.value)} placeholder="补充你的回答" aria-label="回答 Agent" /><Flex gap="2" justify="end" mt="2"><Button size="2" variant="soft" color="gray" onClick={() => respond('')}>跳过</Button><Button size="2" disabled={!answer.trim()} onClick={() => respond(answer.trim())}>回答</Button></Flex></Card>}
  </div>;
}
export function ChangesPanel() {
  const w = useWorkbench(), [list, setList] = useState([]), [detail, setDetail] = useState(null), [tab, setTab] = useState('after');
  const refresh = () => w.inv('changes-list').then(v => setList(v.reverse())).catch(e => w.toast(e.message, 'err'));
  useEffect(() => { setDetail(null); refresh(); }, [w.sid, w.session?.workspace?.id, w.cur.events.length]);
  async function open(id) { try { setDetail(await w.inv('change-detail', { id })); setTab('after'); } catch (e) { w.toast(e.message, 'err'); } }
  async function undo() { try { await w.inv('change-undo', { id: detail.id }); setDetail(await w.inv('change-detail', { id: detail.id })); refresh(); w.toast('已撤销此项改动', 'ok'); } catch (e) { w.toast(e.message, 'err'); } }
  return <><div className="bar"><Text size="2" weight="medium">文件改动 {list.length}</Text><Box flexGrow="1" /><Button size="2" variant="soft" color="gray" onClick={refresh}><Icon n="reload" />刷新</Button></div>
    <Text as="div" size="1" color="gray" m="3">这里记录文件编辑与导出。终端命令产生的改动可通过 Git 查看。</Text>
    {!list.length ? <EmptyState icon="edit" title="暂无文件改动" description="Agent 编辑文件后，可以在这里查看前后内容并撤销。" /> : <div className="file-list">{list.map(item => <button className={'file-row' + (detail?.id === item.id ? ' on' : '')} key={item.id} onClick={() => open(item.id)}><Icon n="file" /><span className="ellipsis mono">{item.path}</span><Text size="1" color="gray">{item.status === 'reverted' ? '已撤销' : item.created ? '新增' : '修改'}</Text></button>)}</div>}
    {detail && <Tabs.Root className="change-detail" value={tab} onValueChange={setTab}><Flex className="bar" align="center"><Tabs.List size="1"><Tabs.Trigger value="before">修改前</Tabs.Trigger><Tabs.Trigger value="after">修改后</Tabs.Trigger></Tabs.List><Box flexGrow="1" /><Button size="2" variant="soft" color="gray" disabled={detail.status !== 'applied' || w.cur.agentRunning || w.cur.mode === 'read-only'} onClick={undo}>撤销此项</Button></Flex><pre className="raw change-code">{tab === 'before' ? detail.before ?? '（文件原本不存在）' : detail.after}</pre></Tabs.Root>}
  </>;
}
