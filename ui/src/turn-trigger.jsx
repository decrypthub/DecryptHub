import React, { useState } from 'react';
import { Icon } from './kit.jsx';

// 与 DSH 的 TurnTriggerNodeView 对齐：自动接续的一轮在对话里显示一条可展开的来源提示。
// 默认收起，标题是“继续执行目标”，右侧是触发时间；展开后解释这一轮为什么开始，并给出目标快照。
const STATUS = {
  running: '正在执行',
  cancelled: '已停止',
  failed: '执行未完成',
  needs_attention: '需要你处理',
  stopped: '已暂停',
  completed: '已完成',
};

function Field({ label, text }) {
  return <div className="turn-trigger-field"><span>{label}</span><p>{text}</p></div>;
}

export function TurnTrigger({ trigger, turn }) {
  const [open, setOpen] = useState(false);
  const notice = trigger.notice || {};
  const at = trigger.at ? new Date(trigger.at) : null;
  const time = at ? at.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '';
  const status = turn.active ? STATUS.running : STATUS[turn.status] || (turn.end?.stop ? STATUS.stopped : '已结束');
  return <section className="turn-trigger" data-turn-trigger="goal" aria-label="目标接续提示">
    <button type="button" className="turn-trigger-head" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <span className="turn-trigger-icon" aria-hidden="true"><Icon n="target" size={14} /></span>
      <span className="turn-trigger-title">继续执行目标</span>
      {time && <time className="turn-trigger-time" dateTime={at.toISOString()}>{time}</time>}
      <Icon n={open ? 'chevup' : 'chevdown'} size={12} className="turn-trigger-chev" />
    </button>
    {open && <div className="turn-trigger-body">
      <p className="turn-trigger-note">这条通知触发了本轮回复。</p>
      <div className="turn-trigger-state"><span className={'turn-trigger-dot ' + (turn.active ? 'run' : turn.status)} aria-hidden="true" />{status}{notice.turns > 0 ? ` · 目标第 ${notice.turns} 轮` : ''}</div>
      {notice.objective && <Field label="目标" text={notice.objective} />}
      {notice.summary && <Field label="最近进展" text={notice.summary} />}
      {notice.nextAction && <Field label="下一步" text={notice.nextAction} />}
      {!notice.objective && !notice.summary && !notice.nextAction && <p className="turn-trigger-note">上一轮结束后，目标满足继续执行的条件。</p>}
    </div>}
  </section>;
}
