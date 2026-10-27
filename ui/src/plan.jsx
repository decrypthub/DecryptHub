import React, { useId, useState } from 'react';
import { Flex, Popover, Text } from '@radix-ui/themes';
import { ActionIcon, Button, Icon } from './kit.jsx';
import { useWorkbench } from './bus.jsx';
import { FALLBACK_TODOS } from './state.js';

const STATUS_LABELS = { pending: '待执行', in_progress: '进行中', completed: '已完成', cancelled: '已取消' };

// Mounted per session so an open plan cannot carry over to a different chat.
export function TodoStrip() {
  const { cur, toast } = useWorkbench(), [open, setOpen] = useState(false), titleId = useId();
  const list = cur.todos || [];
  const untouched = list.length === FALLBACK_TODOS.length && list.every((t, i) => t.id === FALLBACK_TODOS[i].id && t.content === FALLBACK_TODOS[i].content && t.status === 'pending');
  const explicitlyPlanned = (cur.events || []).some(event => event.type === 'tool' && event.name === 'todo_write' && event.result !== undefined && !event.isError);
  if (!list.length || (untouched && !explicitlyPlanned)) return null;
  const done = list.filter(t => t.status === 'completed').length, active = list.find(t => t.status === 'in_progress');
  const summary = active?.content || (done === list.length ? '全部完成' : '任务计划');
  const copy = async () => {
    const text = '# 任务计划\n\n' + list.map(t => `- [${t.status === 'completed' ? 'x' : ' '}] ${t.content.replace(/\r?\n/g, '\n  ')}（${STATUS_LABELS[t.status] || t.status}）`).join('\n');
    try { await navigator.clipboard.writeText(text); toast('计划已复制为 Markdown', 'ok'); }
    catch { toast('无法复制计划，请重试', 'err'); }
  };
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger><button type="button" className="todo-strip" aria-label="查看完整计划" aria-describedby={`${titleId}-summary ${titleId}-count`} title="查看完整计划">
      <Icon n="check" size={14} /><Text size="1" weight="medium" className="todo-summary" id={`${titleId}-summary`}>{summary}</Text>
      <span className="todo-bar" aria-hidden="true"><i style={{ width: (done / list.length * 100) + '%' }} /></span>
      <Text size="1" className="todo-count" id={`${titleId}-count`}>{done}/{list.length}</Text><Icon n={open ? 'chevup' : 'chevdown'} size={14} />
    </button></Popover.Trigger>
    <Popover.Content width="560px" minWidth="0" maxWidth="calc(100vw - 32px)" align="start" side="bottom" sideOffset={8} collisionPadding={16} className="todo-plan" data-overlay aria-labelledby={titleId}>
      <Flex align="center" gap="3" className="todo-plan-head">
        <div><Text as="div" size="2" weight="medium" id={titleId}>任务计划</Text><Text as="div" size="1" color="gray">已完成 {done} / {list.length} 项</Text></div>
        <Button size="2" variant="soft" color="gray" onClick={copy}><Icon n="copy" size={14} />复制计划</Button>
        <Popover.Close><ActionIcon icon="x" size="2" variant="soft" color="gray" title="关闭计划" /></Popover.Close>
      </Flex>
      <ol className="todo-plan-list" aria-label="完整计划步骤" tabIndex={0}>
        {list.map((step, index) => <li key={step.id} className="todo-plan-step" data-status={step.status}>
          <span className="todo-step-marker" aria-hidden="true">{step.status === 'completed' || step.status === 'cancelled' ? <Icon n={step.status === 'completed' ? 'check' : 'x'} size={16} /> : index + 1}</span>
          <span className="todo-step-content">{step.content}</span><span className="todo-step-status">{STATUS_LABELS[step.status] || step.status}</span>
        </li>)}
      </ol>
    </Popover.Content>
  </Popover.Root>;
}
