import React, { useEffect, useId, useState } from 'react';
import { Flex, Popover, Spinner, Text } from '@radix-ui/themes';
import { ActionIcon, Button, Icon, Markdown } from './kit.jsx';
import { useWorkbench } from './bus.jsx';

const LABELS = { running: '研究中', completed: '已完成', failed: '失败', interrupted: '已中断', cancelled: '已取消', limited: '达到上限' };

// Each detail owns its request. Closing it or switching sessions discards late results.
function SubagentRow({ agent }) {
  const { sid, inv } = useWorkbench(), [open, setOpen] = useState(false), [value, setValue] = useState(null), [error, setError] = useState('');
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    let live = true; setValue(null); setError('');
    inv('subagent-result', { sessionId: sid, id: agent.id }).then(result => { if (live) setValue(result); }).catch(e => { if (live) setError(e.message || String(e)); });
    return () => { live = false; };
  }, [open, sid, agent.id, agent.status, inv]);
  return <div className="subagent-row" data-agent-id={agent.id}>
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger><Button size="2" variant="ghost" color="gray" className="subagent-title" title={agent.task || agent.title}>
        {agent.status === 'running' ? <Spinner size="1" /> : <Icon n="layers" size={14} />}<span className="ellipsis">{agent.title}</span><Icon n="chevdown" size={12} />
      </Button></Popover.Trigger>
      <Popover.Content width="480px" maxWidth="calc(100vw - 32px)" minWidth="0" sideOffset={8} collisionPadding={16} data-overlay className="subagent-detail" aria-labelledby={titleId}>
        <Flex align="start" gap="3"><Text size="2" weight="medium" id={titleId} className="subagent-detail-title">{agent.title}</Text><Popover.Close><ActionIcon icon="x" size="1" variant="soft" color="gray" title="关闭子代理详情" /></Popover.Close></Flex>
        <Text as="p" size="1" color="gray">独立上下文 · 只读工作区 · {LABELS[agent.status] || agent.status}</Text>
        <div className="subagent-result" tabIndex={0}>{error ? <Text color="red" role="alert">{error}</Text> : value ? <Markdown text={value.summary || (agent.status === 'running' ? '正在研究，完成后会显示结论。' : '暂无结论。')} /> : <Text color="gray">加载中…</Text>}</div>
      </Popover.Content>
    </Popover.Root>
    <span className="subagent-status">{LABELS[agent.status] || agent.status}</span>
    {agent.status === 'running' && <ActionIcon icon="stop" size="1" variant="soft" color="gray" title="取消子代理" onClick={() => inv('subagent-cancel', { sessionId: sid, id: agent.id }).catch(e => setError(e.message || String(e)))} />}
  </div>;
}

export function TurnSubagents({ agents }) {
  return agents.length ? <div className="turn-subagents" aria-label="本轮子代理">{agents.map(agent => <SubagentRow key={agent.id} agent={agent} />)}</div> : null;
}

export function SubagentButton() {
  const { cur } = useWorkbench(), [open, setOpen] = useState(false), titleId = useId();
  const agents = cur.subagents || [], running = agents.filter(a => a.status === 'running').length;
  if (!agents.length) return null;
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger><Button size="2" variant="soft" color="gray" className="subagents-trigger" aria-label="查看子代理" title={running ? `${running} 项研究中` : `${agents.length} 项子代理任务`}>
      {running ? <Spinner size="1" /> : <Icon n="layers" size={14} />}<span className="progress-name">子代理</span><span>{running || agents.length}</span>
    </Button></Popover.Trigger>
    <Popover.Content width="420px" minWidth="0" maxWidth="calc(100vw - 32px)" align="end" sideOffset={8} collisionPadding={16} data-overlay className="subagents-popover" aria-labelledby={titleId}>
      <Flex align="center" justify="between" mb="3"><Text size="2" weight="medium" id={titleId}>子代理任务</Text><Popover.Close><ActionIcon icon="x" size="1" variant="soft" color="gray" title="关闭子代理列表" /></Popover.Close></Flex>
      <div className="subagents-list">{agents.slice().reverse().map(agent => <SubagentRow key={agent.id} agent={agent} />)}</div>
    </Popover.Content>
  </Popover.Root>;
}
