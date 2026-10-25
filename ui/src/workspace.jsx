import React, { useEffect, useState } from 'react';
import { Box, Flex, Text, Badge, Card, DropdownMenu, TextArea, Tabs } from '@radix-ui/themes';
import { useWorkbench } from './bus.jsx';
import { Button, Icon, askConfirm, EmptyState } from './kit.jsx';
import { native } from './transport.js';

const PERMISSIONS = [
  { id: 'manual', label: '请求批准', icon: 'key', description: '工作区内读写；额外执行和联网权限由你确认' },
  { id: 'auto', label: '自动批准', icon: 'clock', description: '隔离范围内按规则批准；需要额外权限时询问' },
  { id: 'full-access', label: '完全访问权限', icon: 'info', description: '文件、命令、浏览器及已启用工具直接执行' },
  { id: 'read-only', label: '只读查看', icon: 'file', description: '仅查看文件和页面，不运行代码或修改内容' },
];
export function PermissionPicker() {
  const w = useWorkbench();
  const selected = w.cur.mode === 'standard' ? w.cur.review || 'manual' : w.cur.mode;
  async function change(id) {
    if (id === 'full-access' && selected !== id && !await askConfirm('Agent 将使用当前系统用户权限执行命令、访问文件和网络、操控浏览器及调用已启用的外部工具，不再逐次请求批准。此选择仅对当前会话、本次应用运行有效。', { ok: '启用完全访问权限', danger: true })) return;
    try { await w.inv('session-set-mode', { mode: ['manual', 'auto'].includes(id) ? 'standard' : id, review: id === 'auto' ? 'auto' : 'manual' }); } catch (e) { w.toast(e.message, 'err'); }
  }
  return <DropdownMenu.Root><DropdownMenu.Trigger>
    <Button size="2" variant="soft" color={w.cur.mode === 'full-access' ? 'red' : 'gray'} disabled={w.cur.agentRunning} title="选择权限" aria-label="选择权限"><Icon n={PERMISSIONS.find(p => p.id === selected)?.icon || 'key'} />{PERMISSIONS.find(p => p.id === selected)?.label || '请求批准'}<Icon n="chevdown" /></Button>
  </DropdownMenu.Trigger><DropdownMenu.Content className="permission-menu" size="2" align="start" aria-label="权限设置">
    <DropdownMenu.Label>如何批准 Agent 操作？</DropdownMenu.Label>
    <DropdownMenu.RadioGroup value={selected} onValueChange={change}>
      {PERMISSIONS.slice(0, 3).map(p => <DropdownMenu.RadioItem className="permission-option" key={p.id} value={p.id} aria-label={p.label} color={p.id === 'full-access' ? 'red' : undefined}><Icon n={p.icon} /><span className="permission-copy"><strong>{p.label}</strong><span>{p.description}</span></span></DropdownMenu.RadioItem>)}
      <DropdownMenu.Separator />
      <DropdownMenu.RadioItem value="read-only" aria-label="只读查看"><Icon n="file" />只读查看</DropdownMenu.RadioItem>
    </DropdownMenu.RadioGroup>
  </DropdownMenu.Content></DropdownMenu.Root>;
}
export function WorkspaceBar() {
  const w = useWorkbench(), ws = w.session?.workspace;
  const [recent, setRecent] = useState([]), [busy, setBusy] = useState(false), [cap, setCap] = useState(null), [showDetails, setShowDetails] = useState(false);
  useEffect(() => { w.inv('executor-status').then(setCap).catch(() => {}); }, [w.sid]);
  async function choose(recentPath) {
    if (!native.isNative()) { w.toast('请在桌面应用中选择本地文件夹；网页预览可使用会话工作区。', 'info'); return; }
    setBusy(true);
    try { const grant = await native.pickWorkspace(w.sid, recentPath); if (grant) { await w.inv('workspace-set', { grant }); w.toast('工作文件夹已切换', 'ok'); } }
    catch (e) { w.toast('无法打开文件夹：' + e.message, 'err'); } finally { setBusy(false); }
  }
  const actual = w.cur.mode === 'read-only' ? '只读访问' : w.cur.mode === 'full-access' ? '宿主机执行' : cap?.available ? '受限执行' : cap ? '命令逐次确认' : '检测执行环境…';
  return <div className="workspace-area">
    <Flex className="workspace-bar" align="center" justify="between" gap="2">
      <DropdownMenu.Root onOpenChange={open => { if (open) w.inv('workspace-recent').then(setRecent).catch(() => {}); }}><DropdownMenu.Trigger>
        <Button className="workspace-picker" size="2" variant="soft" color="gray" disabled={busy || w.cur.agentRunning} title={ws?.root || '选择工作文件夹'}><Icon n="folder" /><span className="ellipsis">{ws?.label || '会话工作区'}</span><Icon n="chevdown" /></Button>
      </DropdownMenu.Trigger><DropdownMenu.Content size="2" align="start" aria-label="工作文件夹">
        <DropdownMenu.Item onSelect={() => choose()}><Icon n="folder" />选择文件夹…</DropdownMenu.Item>
        <DropdownMenu.Item onSelect={async () => { try { await w.inv('workspace-set', { managed: true }); } catch (e) { w.toast(e.message, 'err'); } }}><Icon n="chat" />不选择文件夹</DropdownMenu.Item>
        {!!recent.length && <><DropdownMenu.Separator /><DropdownMenu.Label>最近使用</DropdownMenu.Label>{recent.map(p => <DropdownMenu.Item key={p.id} onSelect={() => choose(p.root)} title={p.root}><Icon n="folder" />{p.label}</DropdownMenu.Item>)}</>}
        <DropdownMenu.Separator /><DropdownMenu.Item disabled={!ws?.root} onSelect={() => { navigator.clipboard.writeText(ws.root).then(() => w.toast('已复制工作目录', 'ok')).catch(() => w.toast('复制失败', 'err')); }}><Icon n="copy" />复制目录路径</DropdownMenu.Item>
      </DropdownMenu.Content></DropdownMenu.Root>
      <Button size="1" variant="ghost" color={w.cur.mode === 'full-access' ? 'red' : 'gray'} onClick={() => setShowDetails(v => !v)} title="查看执行环境">{actual}<Icon n="info" size={14} /></Button>
    </Flex>
    {showDetails && <div className="workspace-details"><Text size="1" className="mono">{ws?.root}</Text><Text as="div" size="1" color="gray" mt="1">{w.cur.mode === 'full-access' ? '命令使用当前系统用户权限，浏览器与已启用的外部工具直接执行，不再逐次审批。文件工具以当前工作区为根。' : cap?.available ? '命令在当前工作区与网络策略内运行，额外权限按所选方式审批。' : '文件工具仍受工作区边界限制。当前没有可用执行隔离，请求批准和自动批准模式下的命令仍需你确认。批准后命令具有当前系统用户的权限。会话目录会保留，重新打开聊天后可以继续使用。'}</Text><Button size="1" variant="ghost" color="gray" mt="2" onClick={() => w.inv('executor-status', { refresh: true }).then(setCap).catch(e => w.toast(e.message, 'err'))}>重新检测</Button></div>}
    {ws?.missing && <Text as="div" size="1" color="red">原工作文件夹不存在，请重新选择。</Text>}
  </div>;
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
