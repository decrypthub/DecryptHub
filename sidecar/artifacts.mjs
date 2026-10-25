// 「AI 产出」索引：从事件日志里提取工具**真实写盘**的文件。
//
// 为什么不直接列目录：工作区里混着 npm 包、抓包落盘、运行产物、缓存……它们不是 AI 写的。
// 只有工具在返回里声明 `wrote: [...]` 才算产出（见各 write 工具的 return），
// 这样既不靠猜文件名，也不会把「AI 想写但失败了」算进去。
//
// 纯函数，事件形如 { t:'tool', name, at, wrote:[相对路径] }。

const SCRIPT_RE = /\.(js|mjs|cjs|jsx|ts|tsx|py|sh|bash|ps1)$/i;
const DOC_RE = /\.(md|markdown|txt)$/i;

/** 产出分类：脚本 / 笔记与报告 / 数据 */
export function kindOf(name, tool) {
  if (tool === 'notes_write' || tool === 'generate_report') return 'doc';
  if (SCRIPT_RE.test(name)) return 'script';
  if (DOC_RE.test(name)) return 'doc';
  return 'data';
}

/**
 * @param {Array} events 会话事件日志
 * @returns {Array<{path:string,name:string,tool:string,at:number,kind:string,writes:number}>} 最近写入的在前
 */
export function collectArtifacts(events) {
  const map = new Map();
  for (const e of events || []) {
    if (!e || e.t !== 'tool' || !Array.isArray(e.wrote)) continue;
    for (const raw of e.wrote) {
      if (typeof raw !== 'string' || !raw) continue;
      const path = raw.replace(/\\/g, '/').replace(/^\.\//, '');
      const name = path.split('/').pop();
      const prev = map.get(path);
      map.set(path, {
        path, name,
        tool: e.name,
        at: e.at || 0,
        kind: kindOf(name, e.name),
        writes: (prev?.writes || 0) + 1,
      });
    }
  }
  return [...map.values()].sort((a, b) => b.at - a.at);
}

/** 按 脚本 → 笔记与报告 → 数据 分组（组内保持时间倒序），空组不出现 */
export const KIND_LABEL = { script: '脚本', doc: '笔记与报告', data: '数据' };
export function groupArtifacts(list) {
  const order = ['script', 'doc', 'data'];
  const out = new Map(order.map(k => [k, []]));
  for (const a of list || []) (out.get(a.kind) || out.get('data')).push(a);
  return [...out.entries()].filter(([, v]) => v.length).map(([kind, items]) => ({ kind, label: KIND_LABEL[kind] || kind, items }));
}
