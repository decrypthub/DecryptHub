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
// 视觉照产品给的设计图：大号档位名（右侧复位），其下模型行（带箭头），
// 再往下是分段进度条与档位刻度，底部如实写出这一档会放进请求体的参数。
// 设计图顶部的闪电图标已按要求去掉；触发器上也不留。
//
// 档位是「分段进度条」而不是滑杆：条被切成与档位一一对应的等宽小块，点哪块就跳到哪档，
// 没有可拖的把手，也就不会有「拖到两档之间」这种不存在的状态。
// 自己实现而不引 @radix-ui/react-slider：它只是 Radix Themes 的传递依赖，
// 直接 import 会在依赖提升变化时突然找不到，而这里要的恰恰不是 slider 语义。
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Popover, Text } from '@radix-ui/themes';
import { Icon } from './kit.jsx';
import { levelLabel, normalizeThinkingLevels } from '../../sidecar/thinking.mjs';

const indexOf = (levels, value) => levels.indexOf(value);

/** 渠道列表 → 可选的模型行（字符串形式的旧配置也接受），并丢掉空渠道。 */
function modelGroups(providers) {
  return (providers || [])
    .map(p => ({ id: p.id, name: p.name || p.id, models: (p.models || []).map(m => typeof m === 'string' ? { id: m, name: m } : m) }))
    .filter(p => p.models.length);
}

export function ModelSeat({
  providers, providerId, model, levels, value, defaultLevel,
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

  const pickModel = (groupId, m) => { onPickModel(groupId, m.id); setOpen(false); };

  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger>
      <button type="button" className="seat-trigger" aria-label={aria} title={aria} disabled={disabled}>
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
                  className={'seat-item' + (g.id === providerId && m.id === model ? ' on' : '')} onClick={() => pickModel(g.id, m)}>
                  <span className="seat-item-name">{m.name || m.id}</span>
                  {g.id === providerId && m.id === model && <Icon n="check" size={13} className="seat-check" />}
                </button>)}
              </div>)}
              {!filtered.length && <Text as="div" size="1" color="gray" className="seat-empty">没有匹配的模型</Text>}
            </div>
          </div>
        : <div className="seat-pane">
            {hasEffort && <div className="seat-head">
              <Text as="div" className="thinking-level" aria-live="polite">{shown}</Text>
              {isReset && <button type="button" className="thinking-reset" onClick={() => onPickThinking(defaultLevel)} title="恢复模型默认强度" aria-label="恢复模型默认强度"><Icon n="reload" size={13} /></button>}
            </div>}
            <button type="button" className="seat-modelrow" onClick={() => setPane('model')} aria-label={'选择模型，当前 ' + modelName}>
              <span className="seat-modelrow-name">{modelName}</span>
              <Icon n="chevright" size={12} className="seat-chevron" />
            </button>
            {hasEffort && <LevelSlider levels={list} value={value} onChange={onPickThinking} label={'思考强度：' + shown} />}
            {!hasEffort && <Text as="div" size="1" color="gray" className="seat-note">该模型没有声明思考强度：请求里不会带思考参数，由端点自行决定。</Text>}
          </div>}
    </Popover.Content>
  </Popover.Root>;
}

/**
 * 档位条本身：一张「N 段进度条」，每一段就是一个档位，点哪段跳哪档。
 * 没有把手、没有拖动，因此不存在「停在两档之间」的状态。
 * value 为空表示跟随默认（一段都不点亮），此时方向键从第一档开始。
 */
export function LevelSlider({ levels, value, onChange, label = '默认强度', describedBy }) {
  const list = normalizeThinkingLevels(levels);
  const current = indexOf(list, value);
  const pick = index => { if (index >= 0 && index < list.length) onChange(list[index]); };
  // 键盘连续按键时 props 还没回流，直接读 current 会落后一拍（Home 之后立刻 ArrowRight 会停在原地）。
  // 所以这里基于「刚刚提交的值」推算，而不是等重渲染。
  const pending = useRef(value);
  pending.current = value;
  // 焦点走 roving tabindex：Tab 进组只落在当前档（没选就落第一档），← → 在段间移动并立即生效。
  // 每段是真按钮，读屏读到的是「思考强度 中，单选按钮，已选中」，而不是一个说不出值的容器。
  const stepsRef = useRef(null);
  const wantFocus = useRef(-1);
  useEffect(() => {
    const at = wantFocus.current;
    if (at < 0) return;
    wantFocus.current = -1;
    stepsRef.current?.querySelectorAll('.thinking-step')[at]?.focus();
  }, [value]);
  const keydown = event => {
    const last = list.length - 1;
    // 连续按键时 props 还没回流：按「刚刚提交的值」算起点，否则 Home 之后紧跟 ArrowRight 会停在原地。
    const seen = indexOf(list, pending.current);
    const at = seen >= 0 ? seen : 0;
    const delta = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    let next;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    else if (delta !== undefined) next = Math.max(0, Math.min(last, at + delta));
    else return;
    event.preventDefault();
    const target = list[next];
    if (target === undefined) return;
    wantFocus.current = next;
    if (target !== pending.current) { pending.current = target; onChange(target); }
    else stepsRef.current?.querySelectorAll('.thinking-step')[next]?.focus();
  };
  const tabIndex = index => ((current >= 0 ? index === current : index === 0) ? 0 : -1);
  return <div ref={stepsRef} className="thinking-steps" role="radiogroup" aria-label={label} aria-describedby={describedBy} onKeyDown={keydown}>
    {list.map((id, index) => <button type="button" role="radio" key={id} tabIndex={tabIndex(index)}
      className={'thinking-step' + (index === current ? ' on' : '') + (current >= 0 && index < current ? ' done' : '')}
      aria-checked={index === current} aria-label={'思考强度 ' + levelLabel(id)} title={levelLabel(id)}
      onClick={() => pick(index)}>
      <span className="thinking-step-bar" aria-hidden="true" />
      <span className="thinking-step-name" aria-hidden="true">{levelLabel(id)}</span>
    </button>)}
  </div>;
}
