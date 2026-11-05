import React, { useState } from 'react';
import { Popover, Text } from '@radix-ui/themes';
import { Button, Icon } from './kit.jsx';
import { useWorkbench } from './bus.jsx';

export function TeamButton({ onOpen }) {
  const w = useWorkbench(), [open, setOpen] = useState(false);
  if (!w.cur.team?.tasks?.length) return null;
  return <Popover.Root open={open} onOpenChange={setOpen}><Popover.Trigger><Button size="2" color="gray" variant="ghost" aria-label="智能体团队" className="team-trigger"><Icon n="team" size={16} />智能体团队<Icon n="chevdown" size={12} /></Button></Popover.Trigger>
    <Popover.Content data-overlay width="560px" maxWidth="calc(100vw - 24px)" className="team-popover" aria-label="智能体团队任务板">
      <TeamBoard onOpen={id => { setOpen(false); onOpen(id); }} />
    </Popover.Content>
  </Popover.Root>;
}
export function TeamBoard({ onOpen }) {
  const w = useWorkbench(), team = w.cur.team, [expanded, setExpanded] = useState(null);
  if (!team?.enabled && !team?.failure) return null;
  const agents = w.cur.subagents || [], tasks = team.tasks || [], names = new Map([[w.sid, 'lead'], ...agents.map(agent => [agent.id, agent.title])]);
  return <section className="team-board" aria-label="智能体团队任务板">
    {team.failure && <Text as="p" size="1" color="red" role="alert">{team.failure}</Text>}
    <div className="team-section-title">成员 <span>{agents.length + 1}</span></div>
    <div className="team-members"><div className="team-member is-current"><span className={'team-state ' + (w.cur.agentRunning ? 'running' : '')} /><span>lead <small>当前会话</small><em>{w.cur.agentRunning ? '运行中' : '空闲'}</em></span></div>{agents.map(agent => <button type="button" className="team-member" key={agent.id} onClick={() => onOpen(agent.id)}><span className={'team-state ' + (agent.status === 'running' ? 'running' : '')} /><span className="ellipsis">{agent.title}<em>{agent.status === 'running' ? '运行中' : agent.status === 'completed' ? '已完成' : '空闲'}</em></span></button>)}</div>
    <div className="team-section-title">共享任务 <span>{tasks.length}</span></div>
    {!tasks.length && <Text as="p" size="1" color="gray">还没有共享任务。向主代理描述协作目标后，可在这里查看任务分工。</Text>}
    <div className="team-tasks">{tasks.map(task => <div className="team-task" key={task.id}>
      <button type="button" className="team-task-head" aria-expanded={expanded === task.id} onClick={() => setExpanded(value => value === task.id ? null : task.id)}><strong>{task.subject}</strong><span>{task.status === 'completed' ? '已完成' : task.status === 'in_progress' ? '进行中' : task.ready ? '待处理' : '等待依赖'}</span><Icon n={expanded === task.id ? 'chevup' : 'chevdown'} size={13} /></button>
      <p className={expanded === task.id ? '' : 'team-task-preview'}>{task.description}</p>
      <div className="team-task-meta">{task.id} · 负责人：{task.ownerId ? names.get(task.ownerId) || task.ownerId : '未分配'}{task.status === 'pending' && (task.ready ? ' · 可开始' : ' · 等待依赖')}</div>
      {expanded === task.id && <div className="team-task-details">{!!task.blockedBy.length && <p>前置任务：{task.blockedBy.join('、')}</p>}{!!task.writeScopes.length && <p>写入范围：{task.writeScopes.join('、')}</p>}{task.writeScopeWarnings.map(note => <p key={note}>{note}</p>)}</div>}
    </div>)}</div>
  </section>;
}
