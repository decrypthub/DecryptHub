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
// 视觉按用户提供的 ChatGPT 参考图：居中的当前英文档位、模型入口、胶囊滑杆。
// 不提供快速模式或复位按钮，不在底部挤放全部档位名称。
// Slider 使用直接声明的 Radix Primitive；连续拖动预览，松开后只提交最终声明档位。
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Popover, Text } from '@radix-ui/themes';
import * as Slider from '@radix-ui/react-slider';
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
  const [preview, setPreview] = useState(null);
  const searchRef = useRef(null);
  const groups = useMemo(() => modelGroups(providers), [providers]);
  const list = normalizeThinkingLevels(levels);
  const levelSignature = list.join('|');
  const hasEffort = list.length > 0;
  const effectiveValue = list.includes(value) ? value : list.includes(defaultLevel) ? defaultLevel : value;
  const current = indexOf(list, list.includes(preview) ? preview : effectiveValue);
  const shown = current >= 0 ? levelLabel(list[current]) : 'Default';
  const active = (groups.find(g => g.id === providerId)?.models || []).find(m => m.id === model);
  const modelName = active?.name || model || '选择模型';
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
  useEffect(() => { setPreview(null); }, [open, pane, providerId, model, effectiveValue, levelSignature]);
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
    <Popover.Content className="seat-pop" width="320px" sideOffset={8} collisionPadding={16} align="end" data-overlay>
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
        : <div className="seat-pane seat-effort-pane">
            {hasEffort && <div className="seat-head">
              <Text as="div" className="thinking-level" aria-live="polite">{shown}</Text>
            </div>}
            <button type="button" className="seat-modelrow" onClick={() => setPane('model')} aria-label={'选择模型，当前 ' + modelName}>
              <span className="seat-modelrow-name">{modelName}</span>
              <Icon n="chevright" size={12} className="seat-chevron" />
            </button>
            {hasEffort && <LevelSlider key={providerId + '|' + model} levels={list} value={effectiveValue} onChange={onPickThinking} onPreview={setPreview} showValue={false} label="思考强度" />}
            {!hasEffort && <Text as="div" size="1" color="gray" className="seat-note">该模型不支持调整思考强度</Text>}
          </div>}
    </Popover.Content>
  </Popover.Root>;
}

/** 离散档位、连续拖动；指针、触摸、方向键和 Home/End 由 Radix 统一处理。 */
export function LevelSlider({ levels, value, onChange, onPreview, showValue = true, label = '默认强度', describedBy }) {
  const list = normalizeThinkingLevels(levels);
  const [draft, setDraft] = useState(null);
  const revision = useRef(0);
  const signature = list.join('|');
  useEffect(() => { revision.current++; setDraft(null); }, [value, signature]);
  useEffect(() => () => { revision.current++; }, []);
  const selected = draft && draft.signature === signature ? draft.id : value;
  const current = Math.max(0, indexOf(list, selected));
  const change = ([index]) => {
    const id = list[index];
    if (!id) return;
    revision.current++;
    setDraft({ signature, id }); onPreview?.(id);
  };
  const commit = async ([index]) => {
    const id = list[index], at = revision.current;
    if (!id) return;
    try { await onChange(id); }
    finally { if (at === revision.current) { setDraft(null); onPreview?.(null); } }
  };
  if (!list.length) return null;
  return <div className="thinking-control">
    {showValue && <div className="thinking-control-label"><span>{label}</span><span>{levelLabel(list[current])}</span></div>}
    <Slider.Root className="thinking-slider" min={0} max={Math.max(1, list.length - 1)} step={1} value={[current]}
      disabled={list.length === 1} onValueChange={change} onValueCommit={commit}>
      <Slider.Track className="thinking-track"><Slider.Range className="thinking-range" /></Slider.Track>
      <span className="thinking-ticks" aria-hidden="true">{list.map((id, index) => <i key={id} className={index <= current ? 'passed' : undefined} />)}</span>
      <Slider.Thumb className="thinking-thumb" aria-label={label} aria-valuetext={levelLabel(list[current])} aria-describedby={describedBy} />
    </Slider.Root>
  </div>;
}
