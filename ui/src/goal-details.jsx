import React from 'react';
import { Badge, Flex, Popover, Text } from '@radix-ui/themes';
import { Button, Icon, Markdown } from './kit.jsx';

export function GoalDetails({ goal, label }) {
  const criteria = goal.criteria || [], verified = criteria.filter(c => c.status === 'verified').length;
  return <Popover.Root><Popover.Trigger><Button size="1" variant="ghost" color="gray" className="goal-title" aria-label="查看目标进展"><span className="ellipsis">{goal.objective}</span><Icon n="chevdown" size={12} /></Button></Popover.Trigger>
    <Popover.Content width="min(580px, calc(100vw - 40px))" data-overlay className="goal-details">
      <Flex align="center" justify="between" gap="3"><Text weight="medium" size="2">目标与进展</Text><Badge color={goal.status === 'complete' ? 'green' : 'gray'}>{label}</Badge></Flex>
      <p className="goal-objective">{goal.objective}</p>
      {!!criteria.length && <section><h4>完成条件 · {verified}/{criteria.length}</h4><ol className="goal-criteria">{criteria.map((c, i) => <li key={i}><Icon n={c.status === 'verified' ? 'check' : 'dot'} size={15} /><span>{c.content}</span><small>{c.status === 'verified' ? '已验证' : '待验证'}</small></li>)}</ol></section>}
      {goal.summary && <section><h4>当前进展</h4><Markdown text={goal.summary} /></section>}
      {!!goal.evidence?.length && <section><h4>模型记录的验证证据</h4><ul>{goal.evidence.map((item, i) => <li key={i}>{item}</li>)}</ul></section>}
      {goal.nextAction && <section><h4>下一步</h4><p>{goal.nextAction}</p></section>}
      {goal.resumeNote && <p className="goal-resume-note">{goal.resumeNote}</p>}
      {!!goal.checkpoints?.length && <details className="goal-checkpoints"><summary>进展记录（{goal.checkpoints.length}）</summary>{goal.checkpoints.slice().reverse().map((c, i) => <article key={i}><time>{new Date(c.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time><p>{c.summary}</p></article>)}</details>}
      <Text size="1" color="gray">已执行 {goal.turns || 0} 轮{goal.usedTokens ? ` · 累计 ${(goal.usedTokens / 1000).toFixed(1)}k tokens` : ''} · 可随时暂停或补充要求</Text>
    </Popover.Content>
  </Popover.Root>;
}
