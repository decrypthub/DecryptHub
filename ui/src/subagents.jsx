import React, { createContext, useContext, useEffect, useState } from 'react';
import { Popover, Spinner, Text } from '@radix-ui/themes';
import { Button, Icon } from './kit.jsx';
import { useWorkbench } from './bus.jsx';
import { fmtK } from './state.js';

export const SubagentNavigation = createContext(() => {});
export const AGENT_STATUS = { running: '运行中', completed: '已完成', failed: '失败', interrupted: '已中断', cancelled: '已取消', limited: '达到上限' };

export function AgentEntry({ agent, onOpen, now = Date.now() }) {
  const usage = agent.status === 'running' ? agent.liveUsage : agent.usage, tokens = (usage?.prompt || 0) + (usage?.completion || 0);
  const seconds = Math.max(0, Math.floor(((agent.endedAt || now) - agent.startedAt) / 1000));
  const duration = seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
  return <button type="button" className="subagent-entry" onClick={onOpen} title={agent.task || agent.title}>
    <span className="subagent-entry-state">{agent.status === 'running' ? <Spinner size="1" /> : <Icon n={agent.status === 'completed' ? 'check' : 'dot'} size={16} />}</span>
    <span className="subagent-entry-content"><span>{agent.title}</span><small>{agent.preview || agent.task || '独立上下文'} · {AGENT_STATUS[agent.status] || agent.status}</small></span>
    <span className="subagent-entry-metrics">{tokens > 0 && <span>{fmtK(tokens)} tok</span>}{agent.startedAt && <span>{duration}</span>}</span>
    <Icon n="chevright" size={14} />
  </button>;
}
export function TurnSubagents({ agents }) {
  const open = useContext(SubagentNavigation);
  return agents.length ? <div className="turn-subagents" aria-label="本轮子代理">{agents.map(agent => <AgentEntry key={agent.id} agent={agent} onOpen={() => open([agent.id])} />)}</div> : null;
}
export function SubagentButton() {
  const w = useWorkbench(), enter = useContext(SubagentNavigation);
  const [open, setOpen] = useState(false), [now, setNow] = useState(Date.now());
  const agents = w.cur.subagents || [], running = agents.filter(a => a.status === 'running').length;
  useEffect(() => { if (!open || !running) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [open, running]);
  if (!agents.length) return null;
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger><Button size="2" variant="ghost" color="gray" className="subagents-trigger" aria-label="查看子代理" title="查看和进入子代理对话">
      {running ? <Spinner size="1" /> : <Icon n="team" size={16} />}<span>{agents.length} 个子代理</span><Icon n={open ? 'chevup' : 'chevdown'} size={12} />
    </Button></Popover.Trigger>
    <Popover.Content width="560px" minWidth="0" maxWidth="calc(100vw - 24px)" align="end" sideOffset={10} collisionPadding={12} data-overlay className="subagents-popover" aria-label="子代理列表">
      <div className="subagents-list">{agents.length ? agents.map(agent => <AgentEntry key={agent.id} agent={agent} now={now} onOpen={() => { setOpen(false); enter([agent.id]); }} />) : <div className="subagents-empty"><Text size="2">还没有子代理</Text><Text as="p" size="1" color="gray">将独立任务交给子代理，可进入查看过程并继续对话。</Text><Button size="2" variant="soft" onClick={() => { setOpen(false); w.setCommandForm({ name: 'agent', sessionId: w.sid }); }}>创建子代理</Button></div>}</div>
    </Popover.Content>
  </Popover.Root>;
}
