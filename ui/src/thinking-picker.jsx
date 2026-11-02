// 模型座位（model seat）：把「选择模型」和「选择思考强度」做成同一个控件。
//
// 语义照 DeepSeek Harness 的 ModelSelect（packages/client/ui-model-selection）：
//   · 档位不是界面自己造的，而是模型声明出来的（见 sidecar/thinking.mjs）——
//     模型没声明 xhigh，就不会出现「极高」，也就不会把端点不认的值发出去；
//   · 模型和强度是同一个座位的两个面：触发器写「模型名 · 强度」，浮层根面板是
//     「强度」和「模型」两处，模型行带箭头向下钻取到模型目录；
//   · 没有声明推理等级的模型不渲染强度那一块（DSH 里 reasoning === undefined 时该行整个不出现），
//     而不是留一个拖了没反应的滑杆。
//
// 视觉照产品给的设计图：顶部闪电 + 复位，中间大号档位名，其下模型行（带箭头），
// 再往下是离散分段滑杆与档位刻度，底部如实写出这一档会放进请求体的参数。
//
// 滑杆自己实现，不引 @radix-ui/react-slider：它只是 Radix Themes 的传递依赖，
// 直接 import 会在依赖提升变化时突然找不到，而这个控件的语义（离散档位）也不需要完整 slider。
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Flex, Popover, Text } from '@radix-ui/themes';
import { Icon } from './kit.jsx';
import { levelLabel, payloadLabel, normalizeThinkingLevels } from '../../sidecar/thinking.mjs';

const indexOf = (levels, value) => levels.indexOf(value);

/** 渠道列表 → 可选的模型行（字符串形式的旧配置也接受），并丢掉空渠道。 */
function modelGroups(providers) {
  return (providers || [])
    .map(p => ({ id: p.id, name: p.name || p.id, models: (p.models || []).map(m => typeof m === 'string' ? { id: m, name: m } : m) }))
    .filter(p => p.models.length);
}

export function ModelSeat({
  providers, providerId, model, levels, value, transport, defaultLevel,
  onPickModel, onPickThinking, disabled,
}) {
  const [open, setOpen] = useState(false);
  const [pane, setPane] = useState('effort');
  const [query, setQuery] = useState('');
  const searchRef = useRef(null);
  const groups = useMemo(() => modelGroups(providers), [providers]);
  const list = normalizeThinkingLevels(levels);
  const hasEffort = list.length > 0;
  const current = indexOf(list, value);
  const shown = current >= 0 ? levelLabel(list[current]) : '默认';
  const active = (groups.find(g => g.id === providerId)?.models || []).find(m => m.id === model);
  const modelName = active?.name || model || '选择模型';
  const isReset = hasEffort && !!defaultLevel && value !== defaultLevel && list.includes(defaultLevel);
  const payload = hasEffort ? (current >= 0 ? payloadLabel(transport, list[current]) : '不发送思考参数（由端点决定）') : '';
  const searchable = groups.reduce((n, g) => n + g.models.length, 0) > 4;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups.map(g => ({ ...g, models: g.models.filter(m => (m.name || m.id).toLowerCase().includes(q) || m.id.toLowerCase().includes(q)) })).filter(g => g.models.length);
  }, [groups, query]);
  const triggerLabel = hasEffort && current >= 0 ? modelName + ' · ' + shown : modelName;
  const aria = hasEffort
    ? '选择模型与思考强度，当前 ' + modelName + '，强度 ' + shown
    : '选择模型，当前 ' + modelName;

  // 打开时回到强度面（那是这个座位的主要动作），并把上一轮的搜索词清掉。
  useEffect(() => { if (!open) { setPane('effort'); setQuery(''); } }, [open]);
  useEffect(() => { if (open && pane === 'model' && searchable) searchRef.current?.focus(); }, [open, pane, searchable]);

  const pickModel = m => { onPickModel(providerId, m.id); setOpen(false); };

  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger>
      <button type="button" className="seat-trigger" aria-label={aria} title={aria} disabled={disabled}>
        <Icon n="bolt" size={14} className="seat-bolt" />
        <span className="seat-model">{modelName}</span>
        {hasEffort && current >= 0 && <span className="seat-level">{shown}</span>}
        <Icon n="chevdown" size={12} className="seat-chevron" />
      </button>
    </Popover.Trigger>
    <Popover.Content className="seat-pop" width="300px" sideOffset={8} collisionPadding={16} align="end" data-overlay>
      {pane === 'model'
        ? <div className="seat-pane">
            <div className="seat-pane-head">
              <button type="button" className="seat-back" onClick={() => setPane('effort')} aria-label="返回思考强度">
                <Icon n="chevleft" size={13} />模型
              </button>
            </div>
            {searchable && <input ref={searchRef} className="seat-search" type="search" value={query} aria-label="搜索模型"
              placeholder="搜索模型" onChange={e => setQuery(e.target.value)} />}
            <div className="seat-list" role="menu" aria-label="模型">
              {filtered.map(g => <div className="seat-group" key={g.id}>
                <div className="seat-group-name">{g.name}</div>
                {g.models.map(m => <button type="button" key={g.id + '|' + m.id} role="menuitemradio" aria-checked={g.id === providerId && m.id === model}
                  className={'seat-item' + (g.id === providerId && m.id === model ? ' on' : '')} onClick={() => pickModel(m)}>
                  <span className="seat-item-name">{m.name || m.id}</span>
                  {g.id === providerId && m.id === model && <Icon n="check" size={13} className="seat-check" />}
                </button>)}
              </div>)}
              {!filtered.length && <Text as="div" size="1" color="gray" className="seat-empty">没有匹配的模型</Text>}
            </div>
          </div>
        : <div className="seat-pane">
            <Flex align="center" justify="between" gap="2">
              <span className="thinking-bolt" aria-hidden="true"><Icon n="bolt" size={15} /></span>
              {isReset && <button type="button" className="thinking-reset" onClick={() => onPickThinking(defaultLevel)} title="恢复模型默认强度" aria-label="恢复模型默认强度"><Icon n="reload" size={13} /></button>}
            </Flex>
            {hasEffort && <Text as="div" className="thinking-level" aria-live="polite">{shown}</Text>}
            <button type="button" className="seat-modelrow" onClick={() => setPane('model')} aria-label={'选择模型，当前 ' + modelName}>
              <span className="seat-modelrow-name">{modelName}</span>
              <Icon n="chevright" size={12} className="seat-chevron" />
            </button>
            {hasEffort && <>
              <LevelSlider levels={list} value={value} onChange={onPickThinking} label={'思考强度：' + shown} />
              <Text as="div" size="1" color="gray" className="thinking-payload">{payload}</Text>
            </>}
            {!hasEffort && <Text as="div" size="1" color="gray" className="seat-note">该模型没有声明思考强度：请求里不会带思考参数，由端点自行决定。</Text>}
          </div>}
    </Popover.Content>
  </Popover.Root>;
}

/**
 * 分段滑杆本身：只在「声明里有的档位」之间移动。
 * value 为空表示跟随默认（没有选中点），此时左右箭头都从第一档开始。
 */
export function LevelSlider({ levels, value, onChange, label = '默认强度', describedBy }) {
  const list = normalizeThinkingLevels(levels);
  const current = indexOf(list, value);
  const pick = index => { if (index >= 0 && index < list.length) onChange(list[index]); };
  // 键盘连续按键时 props 还没回流，直接读 current 会落后一拍（Home 之后立刻 ArrowRight 会停在原地）。
  // 所以这里基于「刚刚提交的值」推算，而不是等重渲染。
  const pending = useRef(value);
  pending.current = value;
  const keydown = event => {
    const last = list.length - 1;
    const at = indexOf(list, pending.current);
    const delta = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[event.key];
    let next;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    else if (delta !== undefined) next = Math.max(0, Math.min(last, at + delta));
    else return;
    event.preventDefault();
    const target = list[next];
    if (target === pending.current) return;
    pending.current = target;
    onChange(target);
  };
  return <>
    <div className="thinking-slider" role="slider" tabIndex={0} aria-label={label} aria-describedby={describedBy}
      aria-valuemin={1} aria-valuemax={list.length} aria-valuenow={current >= 0 ? current + 1 : undefined}
      aria-valuetext={current >= 0 ? levelLabel(list[current]) : '未选择'} onKeyDown={keydown}>
      <div className="thinking-track" aria-hidden="true">
        <span className="thinking-fill" style={{ width: current >= 0 ? ((current / Math.max(1, list.length - 1)) * 100) + '%' : '0%' }} />
      </div>
      <div className="thinking-stops">
        {list.map((id, index) => <button type="button" key={id} className={'thinking-stop' + (index === current ? ' on' : '') + (current >= 0 && index < current ? ' passed' : '')}
          style={{ left: ((index / Math.max(1, list.length - 1)) * 100) + '%' }}
          onClick={() => pick(index)} title={levelLabel(id)} aria-label={'思考强度 ' + levelLabel(id)} aria-pressed={index === current}>
          <span className="thinking-dot" />
        </button>)}
      </div>
    </div>
    <div className="thinking-ticks" aria-hidden="true">{list.map((id, index) => <span key={id} className={'thinking-tick' + (index === current ? ' on' : '')}>{levelLabel(id)}</span>)}</div>
  </>;
}
