// 思考块的展开状态。
//
// 从旧的 scroll-stick.js 里拆出来：那个文件原本把「滚动定位」和「思考块展开」混在一起，
// 2026-11-02 重建滚动系统时（见 chat-scroll.js）把滚动部分整体替换掉，
// 这两个与滚动无关的函数移到这里。
//
// 为什么单独成文件：展开状态是**纯视图状态**，和滚动定位没有任何关系；
// 混在一个文件里会让人误以为改滚动要动它，反之亦然。

/**
 * 某个思考块是否处于展开状态。
 * 视图里存的是「已展开的消息 id 列表」，逐个记住，互不影响。
 * @param {object} view 当前会话视图
 * @param {{id?:string,itemId?:string}} event 事件或消息
 * @returns {boolean}
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
 * @param {number} limit 最多记住多少个已展开项
 * @returns {string[]|null} 新列表；没有可用的 id 时返回 null
 */
export function toggleReasoning(view, event, limit = 200) {
  const id = event?.id || event?.itemId;
  if (!id) return null;
  const current = Array.isArray(view?.reasoningOpen) ? view.reasoningOpen : [];
  const next = current.includes(id) ? current.filter(x => x !== id) : [...current, id];
  return next.slice(-limit);
}
