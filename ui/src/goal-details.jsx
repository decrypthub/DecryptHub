import React, { useId, useState } from 'react';
import { Badge, Flex, Popover, Text } from '@radix-ui/themes';
import { ActionIcon, Button, Icon, Markdown } from './kit.jsx';
import { useWorkbench } from './bus.jsx';

export function GoalDetails({ goal }) {
  const w = useWorkbench(), titleId = useId(), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const label = { active: '进行中', paused: '已暂停', complete: '已完成', needs_attention: '需要处理' }[goal.status] || goal.status;
  async function action(name) {
    if (busy) return;
    const sid = w.sid; setBusy(true); setError('');
    try {
      const result = await w.api.invoke('goal-action', { sessionId: sid, action: name });
      if (!result.ok && w.isCurrentSession(sid)) setError(result.error || '目标操作失败');
    } catch (e) { if (w.isCurrentSession(sid)) setError(e.message); }
    finally { if (w.isCurrentSession(sid)) setBusy(false); }
  }
  const criteria = goal.criteria || [], verified = criteria.filter(c => c.status === 'verified').length;
  return <Popover.Root><Popover.Trigger><Button size="2" variant="soft" color="gray" className="goal-trigger" aria-label="查看目标进展" title={goal.objective + ' · ' + label}><Icon n="target" size={14} /><span className="progress-name">目标</span><span className="goal-status">{label}</span><Icon n="chevdown" size={12} className="progress-chevron" /></Button></Popover.Trigger>
    <Popover.Content width="480px" minWidth="0" maxWidth="calc(100vw - 32px)" align="end" side="bottom" sideOffset={8} collisionPadding={16} data-overlay className="goal-details" aria-labelledby={titleId}>
      <Flex align="center" gap="3"><Text weight="medium" size="2" id={titleId} style={{ flex: 1 }}>目标与进展</Text><Badge color={goal.status === 'complete' ? 'green' : 'gray'}>{label}</Badge><Popover.Close><ActionIcon icon="x" title="关闭目标详情" /></Popover.Close></Flex>
      <div className="goal-details-body" tabIndex={0} aria-label="目标详细内容">
      <p className="goal-objective">{goal.objective}</p>
      {!!criteria.length && <section><h4>完成条件 · {verified}/{criteria.length}</h4><ol className="goal-criteria">{criteria.map((c, i) => <li key={i}><Icon n={c.status === 'verified' ? 'check' : 'dot'} size={15} /><span>{c.content}</span><small>{c.status === 'verified' ? '已验证' : '待验证'}</small></li>)}</ol></section>}
      {goal.summary && <section><h4>当前进展</h4><Markdown text={goal.summary} /></section>}
      {!!goal.evidence?.length && <section><h4>模型记录的验证证据</h4><ul>{goal.evidence.map((item, i) => <li key={i}>{item}</li>)}</ul></section>}
      {goal.nextAction && <section><h4>下一步</h4><p>{goal.nextAction}</p></section>}
      {goal.resumeNote && <p className="goal-resume-note">{goal.resumeNote}</p>}
      {!!goal.checkpoints?.length && <details className="goal-checkpoints"><summary>进展记录（{goal.checkpoints.length}）</summary>{goal.checkpoints.slice().reverse().map((c, i) => <article key={i}><time>{new Date(c.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time><p>{c.summary}</p></article>)}</details>}
      <Text size="1" color="gray">已执行 {goal.turns || 0} 轮{goal.usedTokens ? ` · 累计 ${(goal.usedTokens / 1000).toFixed(1)}k tokens` : ''} · 可随时暂停或补充要求</Text>
      </div>
      {error && <Text as="p" size="1" color="red" role="alert">{error}</Text>}
      <Flex justify="end" gap="2" mt="4" wrap="wrap">
        <Button size="2" variant="soft" color="gray" disabled={busy} onClick={() => action('clear')}>结束并收起目标</Button>
        {goal.status === 'active' ? <Button size="2" variant="soft" color="gray" disabled={busy} onClick={() => action('pause')}><Icon n="pause" />暂停目标</Button> : goal.status !== 'complete' && <Button size="2" variant="soft" color="gray" disabled={busy || w.cur.agentRunning} onClick={() => action('resume')}><Icon n="play" />继续目标</Button>}
      </Flex>
    </Popover.Content>
  </Popover.Root>;
}
