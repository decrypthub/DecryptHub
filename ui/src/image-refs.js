// 回复正文里的图片引用：纯逻辑，零依赖。
//
// 单独成一个模块的原因：md.js 顶层 import 了 highlight.js 的 CSS，node 的测试
// 进程无法加载 .css，所以任何想被 node:test 直接 import 的纯函数都不能住在 md.js 里
// （见 BASELINE.md「共享模块保持零 top-level import」）。
//
// 语法：![说明](image:<附件id>)
// 只认本会话附件 id 的形状（uuid），其他 image: 目标原样留在文本里，不产生图片。
const IMAGE_REF = /!\[([^\]\n]*)\]\(image:([a-f0-9-]{36})\)/g;

/**
 * 把正文切成 [{type:'text',text}, {type:'image',id,label}] 交错的片段。
 * @param {string} text
 */
export function splitImageRefs(text) {
  const src = String(text ?? '');
  const out = [];
  let last = 0;
  for (const m of src.matchAll(IMAGE_REF)) {
    if (m.index > last) out.push({ type: 'text', text: src.slice(last, m.index) });
    out.push({ type: 'image', id: m[2], label: m[1] || '图片' });
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ type: 'text', text: src.slice(last) });
  return out.length ? out : [{ type: 'text', text: src }];
}
