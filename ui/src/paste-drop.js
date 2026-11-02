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
