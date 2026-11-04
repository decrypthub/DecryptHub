// DSH terminal-bash/session.ts read contract: independent, newest-relative pages.
export function utf8Tail(text, maxBytes) {
  const buffer = Buffer.from(text);
  if (buffer.length <= maxBytes) return { text, truncated: false };
  let start = buffer.length - maxBytes;
  while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) start++;
  return { text: buffer.subarray(start).toString('utf8'), truncated: true };
}
export function readTerminalPage(snapshot, { offset = 0, count = 500 } = {}, maxBytes = 256 * 1024) {
  if (!Number.isSafeInteger(offset) || offset < 0) throw Error('终端 offset 必须是非负整数');
  if (!Number.isSafeInteger(count) || count <= 0) throw Error('终端 count 必须是正整数');
  const lines = snapshot.text ? snapshot.text.split('\n') : [], totalLines = lines.length;
  if (offset >= totalLines) return { text: '', totalLines, lineBegin: offset, lineEnd: offset, truncated: snapshot.truncated };
  const end = totalLines - offset, start = Math.max(0, end - count);
  const page = utf8Tail(lines.slice(start, end).join('\n'), maxBytes);
  return { text: page.text, totalLines, lineBegin: offset, lineEnd: offset + (page.text ? page.text.split('\n').length : 0), truncated: snapshot.truncated || page.truncated };
}
