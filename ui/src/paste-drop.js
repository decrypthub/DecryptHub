// 长文本粘贴落盘的共享阈值。
//
// 与 sidecar/paste-drop.mjs 的 PASTE_LIMIT 必须一致：前端用它在粘贴时决定
// 是否改写，后端用它做最终守门。两边不一致会出现「界面以为存成文件了、
// 后端却仍当普通消息」这种对不上的状态。
export const PASTE_LIMIT = 20000;

/** 判断一段粘贴文本是否应该落盘。 */
export function shouldDropPaste(text) {
  return String(text ?? '').length > PASTE_LIMIT;
}

/** 从粘贴内容推测一个合适的扩展名，让落盘文件在编辑器里有高亮。 */
export function guessPasteName(text) {
  const head = String(text ?? '').slice(0, 2000);
  if (/^\s*[{[][\s\S]*[}\]]\s*$/.test(head)) return 'pasted.json';
  if (/^#{1,6}\s|^[-*]\s|^\d+\.\s/m.test(head)) return 'pasted.md';
  return 'pasted.txt';
}

/**
 * 在光标处插入文本，并让这次插入成为**独立的撤销边界**。
 *
 * 为什么不能直接 setInput(拼接结果)：
 *   受控 textarea 的 value 由 React 重写，浏览器原生 undo 栈与 DOM 状态脱节。
 *   结果是 Ctrl+Z 的行为不可预测——常见两种坏情况：
 *     1. 一次撤销把「粘贴的内容」和「粘贴之后打的字」一起干掉；
 *     2. 撤销把内容退回到某个更早的受控快照，用户看到莫名其妙的内容。
 * 参考 DSH `ui-conversation/input/editor/runtime.ts` 的 PASTE_TAG 思路：
 *   粘贴要自成一段历史，撤销一次只回到粘贴之前。
 *
 * 做法：用 execCommand('insertText') 走浏览器原生的编辑命令，
 *   它会自然产生一个 undo 分隔点；同时把结果同步回 React 状态。
 * execCommand 已废弃但在所有主流内核里仍可用；失败时回退到普通拼接（不抛错，
 * 因为「撤销粒度不理想」远好于「粘贴直接失败」）。
 *
 * @returns 插入后的完整文本（同时已通过 onChange 回写给 React）
 */
export function insertWithUndoBoundary(el, text, setValue, selectionStart, selectionEnd) {
  text = String(text ?? '');
  if (!el || !text) return;
  const start = Number.isInteger(selectionStart) ? selectionStart : (el.selectionStart ?? el.value.length);
  const end = Number.isInteger(selectionEnd) ? selectionEnd : (el.selectionEnd ?? el.value.length);
  try {
    el.focus();
    el.setSelectionRange(start, end);
    // 先落一个显式分隔点，再插入：部分内核只在连续输入之间合并历史。
    let ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch { ok = false; }
    if (!ok) {
      const next = el.value.slice(0, start) + text + el.value.slice(end);
      el.value = next;
      el.setSelectionRange(start + text.length, start + text.length);
    }
    setValue(el.value);
    const caret = start + text.length;
    el.setSelectionRange(caret, caret);
  } catch {
    // execCommand 完全不可用时，退化成普通拼接；用户仍能正常粘贴。
    const next = el.value.slice(0, start) + text + el.value.slice(end);
    setValue(next);
  }
}
