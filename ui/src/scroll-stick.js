// 会话切换 / 重新打开时的滚动定位。
//
// 背景：.msgs 的 key 绑定会话 id，切换会话时整个滚动容器重建、scrollTop 归零；
// 历史又是异步加载的。旧实现只判断「距底部 < 160px 才跟随」，于是重建后的空容器
// 永远不满足条件，用户停在顶部要一直往下翻。
//
// 这里把判定抽成纯函数，让 UI 与测试共用同一份逻辑，避免两边写法漂移。
//
// 2026-11-02 参照 DSH `ui-chat/chat/use-scroll-follow.ts` 与 `use-chat-reading.ts` 重做：
//   · 跟随意图（followingTail）是**显式状态**，不靠几何距离反推
//   · 跟随尾部时**清空**保存位置，而不是保存"接近底部"的坐标
//   · 恢复位置按「距底部像素」重算，绝不回放绝对 scrollTop
//
// 判为「已在底部」的容差。比 160 小很多：160 会把"距底 155px 但用户其实已上翻"
// 误判成贴底并清空位置，导致下次打开从头开始。
export const BOTTOM_TOLERANCE = 24;

/**
 * 决定这次是否应当把视图贴到底部。
 * @param {{scrollHeight:number, scrollTop:number, clientHeight:number}} box 当前滚动盒
 * @param {{sid:string|null, settled:boolean}} state 该会话的粘性状态（会被就地更新）
 * @param {string} sid 当前会话 id
 * @param {number} threshold 判定「已在底部」的容差像素
 */
export function shouldStick(box, state, sid, threshold = 160) {
  const fresh = state.sid !== sid || !state.settled;
  if (fresh) state.sid = sid;
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < threshold;
  return { stick: fresh || nearBottom, fresh };
}

/**
 * 立即落位，不播放滚动动画。
 *
 * .msgs 上有 scroll-behavior: smooth，直接写 scrollTop 不会瞬时跳转：浏览器把它
 * 当成一次「平滑滚动」请求，从当前位置一路演过去。切换会话时容器刚重建、scrollTop
 * 为 0，于是用户看到整段对话从顶部滚到底部（内容越长动画越久）。跟随新消息同理，
 * 每次都重新起一段动画，反而落后于流式输出。
 *
 * 程序化定位（贴底 / 恢复阅读位置）必须是瞬时的，所以这里临时把 scroll-behavior
 * 压成 auto 再赋值：滚动行为在调用那一刻解析，赋完即可恢复，动画不会残留。
 * 用 !important 覆盖可能带 !important 的样式；结束后还原，不影响用户自己滚动的平滑感。
 * @param {{style:CSSStyleDeclaration, scrollTop:number}|null} node 滚动容器
 * @param {number} top 目标 scrollTop（超出范围由浏览器夹取）
 */
export function jumpTo(node, top) {
  if (!node) return;
  const target = Math.max(0, Math.round(Number(top) || 0));
  const style = node.style;
  const before = style.getPropertyValue('scroll-behavior');
  const priority = style.getPropertyPriority('scroll-behavior');
  style.setProperty('scroll-behavior', 'auto', 'important');
  try { node.scrollTop = target; }
  finally {
    if (before) style.setProperty('scroll-behavior', before, priority);
    else style.removeProperty('scroll-behavior');
  }
}

/**
 * 首次进入会话时该滚到哪里：
 * - 用户上次主动往上翻过（saved 存在）→ 回到那个位置
 * - 否则 → 贴底（默认跟上最新进展）
 * 返回值是 scrollTop 目标；null 表示交给贴底逻辑。
 *
 * 参考 DSH `ChatReading.restore()` 的语义：**保存位置记的是「距底部多少」，
 * 不是绝对 scrollTop**。绝对值的致命问题：保存时高度是 3000，加载完成高度变成 5000，
 * 用回 1200 这个绝对值就落到了中段——用户看到的是「怎么跑到这儿了」。
 * @param {{scrollHeight:number, clientHeight:number}} box
 * @param {{top:number, fromBottom?:number}|null} saved 之前保存的阅读位置
 */
export function restoreTarget(box, saved) {
  if (!saved) return null;
  const max = Math.max(0, box.scrollHeight - box.clientHeight);
  // 优先用「距底部距离」重算；旧数据只有 top 时按保存时的 max 推算一次。
  let fromBottom;
  if (Number.isFinite(saved.fromBottom)) fromBottom = saved.fromBottom;
  else if (Number.isFinite(saved.max) && Number.isFinite(saved.top) && saved.top > 0) {
    fromBottom = Math.max(0, saved.max - saved.top);
  } else if (Number.isFinite(saved.top) && saved.top > 0) {
    // 只有 top、没有 max/fromBottom 的旧记录。
    // 这类值**部分可信**：旧代码在历史未加载完（scrollHeight 很小）时也会写入，
    // 那时存下的 top 相对现在的真实高度几乎必然偏小——回放它会落在顶部附近，
    // 正是「关掉再打开跳到最上面」。
    // 判据：top 明显超过一屏（≥ 2 倍可视高度）才认为"用户真的翻上去过"；
    // 更小的值视为噪声，放弃恢复、改为贴底。
    if (saved.top < box.clientHeight * 2) return null;
    fromBottom = Math.max(0, max - saved.top);
  } else return null;
  if (fromBottom <= 0) return null;
  // 已经接近底部（默认贴底）就别恢复了，贴底更符合预期。
  if (fromBottom < 160) return null;
  return Math.max(0, max - fromBottom);
}

/**
 * 某个思考块是否处于展开状态。
 * 视图里存的是「已展开的消息 id 列表」，逐个记住，互不影响。
 */
export function reasoningOpen(view, event) {
  const id = event?.id || event?.itemId;
  return !!(id && Array.isArray(view?.reasoningOpen) && view.reasoningOpen.includes(id));
}

/**
 * 切换某个思考块的展开状态，返回新的 id 列表。
 * 超出上限时丢掉最早展开的，避免长期会话无限增长。
 * @param {object} view 当前会话视图
 * @param {{id?:string,itemId?:string}} event
 * @param {number} limit
 */
export function toggleReasoning(view, event, limit = 200) {
  const id = event?.id || event?.itemId;
  if (!id) return null;
  const current = Array.isArray(view?.reasoningOpen) ? view.reasoningOpen : [];
  const next = current.includes(id) ? current.filter(x => x !== id) : [...current, id];
  return next.slice(-limit);
}

/**
 * 首次进入会话时的落位与后续稳定化。
 *
 * 恢复模式按「距底部多少像素」而不是绝对 scrollTop 重算：
 * 异步历史会持续改变总高度，用绝对位置会让视角漂到别处。
 *
 * @param {object} opts
 * @param {() => ({scrollHeight:number, clientHeight:number, scrollTop:number} | null)} opts.read 读当前滚动盒
 * @param {(top:number) => void} opts.apply 设置 scrollTop
 * @param {() => boolean} opts.alive 会话是否仍是要定位的那个
 * @param {{top:number}|null} opts.saved 上次保存的阅读位置
 * @param {(fn:Function) => void} opts.schedule 通常 requestAnimationFrame
 * @param {() => void} [opts.onSettled] 高度稳定后的回调
 * @param {number} opts.stableFrames
 */
export function settleInto({ read, apply, alive, saved, schedule, onSettled, stableFrames = 3 }) {
  const first = read();
  if (!first) return;
  const target = restoreTarget(first, saved);
  const restoring = target !== null;
  // 记忆的是「距底部距离」，这样内容长高后位置不会漂。
  let fromBottom = restoring ? Math.max(0, first.scrollHeight - first.clientHeight - target) : 0;
  apply(restoring ? target : first.scrollHeight);
  let frames = 0;
  let lastHeight = first.scrollHeight;
  const step = () => {
    if (!alive()) return;
    const box = read();
    if (!box) return;
    if (box.scrollHeight !== lastHeight) {
      lastHeight = box.scrollHeight;
      frames = 0;
      apply(restoring ? Math.max(0, box.scrollHeight - box.clientHeight - fromBottom) : box.scrollHeight);
    }
    if (++frames < stableFrames) { schedule(step); return; }
    onSettled?.();
  };
  schedule(step);
}
