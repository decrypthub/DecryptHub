// 思考强度选择器：闪电图标 + 大号当前档位 + 分段滑杆。
//
// 形态参考常见的 AI 客户端「推理强度」浮层，但这里刻意保留两处不同：
//   1) 档位只来自模型的声明（见 sidecar/thinking.mjs），滑块不会给出模型没有的档位；
//   2) 底部如实写出这一档会放进请求体的参数，避免「拖到最高」和「真的发了 high」是两回事。
//
// 滑杆自己实现，不引 @radix-ui/react-slider：它只是 Radix Themes 的传递依赖，
// 直接 import 会在依赖提升变化时突然找不到，而这个控件的语义（离散档位）也不需要完整 slider。
import React, { useId, useRef, useState } from 'react';
import { Flex, Popover, Text } from '@radix-ui/themes';
import { Icon } from './kit.jsx';
import { levelLabel, payloadLabel, normalizeThinkingLevels } from '../../sidecar/thinking.mjs';

const indexOf = (levels, value) => levels.indexOf(value);

export function ThinkingPicker({ levels, value, transport, defaultLevel, modelLabel, onChange }) {
  const [open, setOpen] = useState(false), trackId = useId();
  const list = normalizeThinkingLevels(levels);
  if (!list.length) return null;
  const current = indexOf(list, value);
  const shown = current >= 0 ? levelLabel(list[current]) : '默认';
  const isReset = !!defaultLevel && value !== defaultLevel && list.includes(defaultLevel);
  const payload = current >= 0 ? payloadLabel(transport, list[current]) : '不发送思考参数（由端点决定）';

  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger>
      <button type="button" className="thinking-trigger" aria-label={'思考强度：' + shown} title={'思考强度：' + shown}>
        <Icon n="bolt" size={14} />
        <span>{shown}</span>
      </button>
    </Popover.Trigger>
    <Popover.Content className="thinking-pop" width="292px" sideOffset={8} collisionPadding={16} align="end" data-overlay>
      <Flex align="center" justify="between" gap="2">
        <span className="thinking-bolt" aria-hidden="true"><Icon n="bolt" size={15} /></span>
        {isReset && <button type="button" className="thinking-reset" onClick={() => onChange(defaultLevel)} title="恢复模型默认强度" aria-label="恢复模型默认强度"><Icon n="reload" size={13} /></button>}
      </Flex>
      <Text as="div" className="thinking-level" aria-live="polite">{shown}</Text>
      {modelLabel && <Text as="div" size="1" color="gray" className="thinking-model">{modelLabel}</Text>}
      <LevelSlider levels={list} value={value} onChange={onChange} label={'思考强度：' + shown} describedBy={trackId} />
      <Text as="div" size="1" color="gray" className="thinking-payload" id={trackId}>{payload}</Text>
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
