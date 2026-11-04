import React, { useEffect, useState } from 'react';
import { Box, Flex, Text, Badge, Card, TextArea, Tabs, DropdownMenu } from '@radix-ui/themes';
import { useWorkbench } from './bus.jsx';
import { Button, Icon, askRiskConfirm, EmptyState, Markdown } from './kit.jsx';
import { PERMISSION_PRESETS, FULL_ACCESS_PRESET, currentPreset, presetLabel, presetDescription, presetKnobs } from '../../sidecar/permission-presets.mjs';

/** 盾牌图标：三档共用一副轮廓，只有内芯不同（与 DSH 的 PermissionIcon 一致）。
 *  `custom`（自动批准）没有图标——它不是一个可选项，界面只显示它的名字。 */
function PermissionGlyph({ id }) {
  const name = id === 'read-only' ? 'shield-check' : id === 'full-access' ? 'shield-full' : id === 'workspace-write' ? 'shield-write' : null;
  return name ? <Icon n={name} /> : null;
}

// 完全权限的风险确认文案。对应 DSH 的 ui-permission-presets locale
// （`confirm.*` 与 `accessZh.*`），并保留 DecryptHub 自己的两条真实语义：
// 运行中切换「立即生效、且会放行正在等待的批准」，以及本档位会持续到用户改回来。
const FULL_ACCESS_CONFIRM = {
  title: '确认启用完全权限？',
  description: '启用完全权限后，Agent 将减少确认步骤，并且可以直接执行更多操作，包括敏感操作、文件修改或外部命令。任务运行中切换会立即生效，正在等待的批准会直接放行；降级不会中断已启动的进程。此选择会随本会话保存，重启后仍然有效。仅建议在你信任后续任务时使用。',
  acknowledge: '我已了解风险，并愿意继续',
  confirm: '启用完全权限',
};

export function PermissionPicker() {
  const w = useWorkbench(), [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  // 当前值由两个旋钮推导，不是另存的第三处状态：切换后界面立刻正确，
  // 也不会出现「界面显示 A、实际按 B 执行」。
  const selected = currentPreset(w.cur.mode, w.cur.review);
  useEffect(() => setOpen(false), [w.sid]);
  async function change(id) {
    const sid = w.sid; if (id === selected) return;
    if (id === FULL_ACCESS_PRESET && !await askRiskConfirm(FULL_ACCESS_CONFIRM)) return;
    if (!w.isCurrentSession(sid)) return;
    setBusy(true);
    try { await w.api.invoke('session-set-mode', { sessionId: sid, ...presetKnobs(id) }); }
    catch (e) { w.toast(e.message, 'err'); } finally { setBusy(false); }
  }
  return <DropdownMenu.Root open={open} onOpenChange={setOpen}><DropdownMenu.Trigger><Button size="2" variant="soft" color={selected === FULL_ACCESS_PRESET ? 'red' : 'gray'} disabled={busy} aria-label={'访问模式，当前：' + presetLabel(selected)} title={presetDescription(selected)}><PermissionGlyph id={selected} /><span className="perm-label">{presetLabel(selected)}</span><Icon n="chevdown" /></Button></DropdownMenu.Trigger>
    <DropdownMenu.Content align="start" side="top" data-overlay className="permission-menu"><DropdownMenu.Label>权限</DropdownMenu.Label><DropdownMenu.RadioGroup value={selected} onValueChange={change}>{PERMISSION_PRESETS.map(p => <DropdownMenu.RadioItem key={p.id} value={p.id} aria-label={p.label} disabled={busy} className="permission-menu-item"><PermissionGlyph id={p.id} />{p.label}</DropdownMenu.RadioItem>)}</DropdownMenu.RadioGroup></DropdownMenu.Content>
  </DropdownMenu.Root>;
}
export function PendingActions() {
  const w = useWorkbench(), approvals = w.cur.approvals || [];
  const [answer, setAnswer] = useState(''), [busy, setBusy] = useState('');
  async function reply(req, allow, always = false) {
    setBusy(req.id); try { await w.inv('agent-approval-reply', { id: req.id, allow, always }); } catch (e) { w.toast(e.message, 'err'); } finally { setBusy(''); }
  }
  const question = w.cur.question;
  async function respond(value, skipped = false) { if (!question) return; try { await w.inv('agent-answer', { id: question.id, answer: value, skipped }); setAnswer(''); } catch (e) { w.toast(e.message, 'err'); } }
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
    {question && <Card size="2" className={question.kind === 'plan' ? 'plan-review-card' : undefined}><Text size="2" weight="bold">{question.question}</Text>{question.detail && (question.kind === 'plan' ? <div className="plan-review-body"><Markdown text={question.detail} /></div> : <Text as="div" size="1" color="gray" mt="2">{question.detail}</Text>)}<Flex gap="2" wrap="wrap" mt="3">{(question.options || []).map(option => <Button size="2" key={option} variant="soft" color="gray" onClick={() => respond(option)}>{option}</Button>)}</Flex><TextArea size="2" mt="2" value={answer} onChange={e => setAnswer(e.target.value)} placeholder="补充你的回答" aria-label="回答 Agent" /><Flex gap="2" justify="end" mt="2"><Button size="2" variant="soft" color="gray" onClick={() => respond('', true)}>跳过</Button><Button size="2" disabled={!answer.trim()} onClick={() => respond(answer.trim())}>回答</Button></Flex></Card>}
  </div>;
}
export function ChangesPanel() {
  const w = useWorkbench(), [list, setList] = useState([]), [detail, setDetail] = useState(null), [tab, setTab] = useState('after');
  const refresh = () => w.inv('changes-list').then(v => setList(v.reverse())).catch(e => w.toast(e.message, 'err'));
  useEffect(() => { setDetail(null); refresh(); }, [w.sid, w.session?.workspace?.id, w.cur.events.length]);
  async function open(id) { try { setDetail(await w.inv('change-detail', { id })); setTab('after'); } catch (e) { w.toast(e.message, 'err'); } }
  async function undo() { try { await w.inv('change-undo', { id: detail.id }); setDetail(await w.inv('change-detail', { id: detail.id })); refresh(); w.toast('已撤销此项改动', 'ok'); } catch (e) { w.toast(e.message, 'err'); } }
  async function page(offset) { try { setDetail(await w.inv('change-detail', { id: detail.id, offset })); } catch (e) { w.toast(e.message, 'err'); } }
  return <><div className="bar"><Text size="2" weight="medium">文件改动 {list.length}</Text><Box flexGrow="1" /><Button size="2" variant="soft" color="gray" onClick={refresh}><Icon n="reload" />刷新</Button></div>
    <Text as="div" size="1" color="gray" m="3">这里记录文件编辑与导出。终端命令产生的改动可通过 Git 查看。</Text>
    {!list.length ? <EmptyState icon="edit" title="暂无文件改动" description="Agent 编辑文件后，可以在这里查看前后内容并撤销。" /> : <div className="file-list">{list.map(item => <button className={'file-row' + (detail?.id === item.id ? ' on' : '')} key={item.id} onClick={() => open(item.id)}><Icon n="file" /><span className="ellipsis mono">{item.path}</span><Text size="1" color="gray">{item.status === 'reverted' ? '已撤销' : item.created ? '新增' : '修改'}</Text></button>)}</div>}
    {detail && <Tabs.Root className="change-detail" value={tab} onValueChange={setTab}><Flex className="bar" align="center"><Tabs.List size="1"><Tabs.Trigger value="before">修改前</Tabs.Trigger><Tabs.Trigger value="after">修改后</Tabs.Trigger></Tabs.List><Box flexGrow="1" /><Button size="2" variant="soft" color="gray" disabled={detail.status !== 'applied' || w.cur.agentRunning || w.cur.mode === 'read-only'} onClick={undo}>撤销此项</Button></Flex><pre className="raw change-code">{tab === 'before' ? detail.before ?? '（文件原本不存在）' : detail.after}</pre>{detail.windows?.[tab] && <Flex p="2" align="center" gap="2"><Button size="1" variant="soft" color="gray" disabled={!detail.windows[tab].offset} onClick={() => page(Math.max(0, detail.windows[tab].offset - 80000))}>上一段</Button><Text size="1" color="gray">{detail.windows[tab].offset + 1}–{Math.min(detail.windows[tab].offset + 80000, detail.windows[tab].totalChars)} / {detail.windows[tab].totalChars} 字符</Text><Button size="1" variant="soft" color="gray" disabled={!detail.windows[tab].truncated} onClick={() => page(detail.windows[tab].offset + 80000)}>下一段</Button></Flex>}</Tabs.Root>}
  </>;
}
