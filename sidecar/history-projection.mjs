// Pure, browser-safe adaptation of DSH core/session/surface.ts's positional
// replacement contract. Original events remain the human transcript.
const modelTypes = new Set(['user', 'assistant', 'tool', 'continuation']);
const sequence = value => Number.isSafeInteger(value) && value >= 0;
export function projectHistory(events = []) {
  const nodes = [], replacedBy = new Map(), replacements = new Map();
  for (let seq = 0; seq < events.length; seq++) {
    const event = events[seq];
    if (!modelTypes.has(event.t) && !['summary', 'system', 'notice', 'turn-end'].includes(event.t) && event.ignorable === true) continue;
    if (event.t !== 'summary') {
      if (event.surfaceOp !== undefined && event.surfaceOp !== 'append') throw Error('只有摘要可以替换模型上下文区间');
      if (modelTypes.has(event.t)) nodes.push({ seq, event });
      continue;
    }
    // v1/v2 checkpoints covered the complete earlier view. Keep their meaning
    // instead of inventing a retained tail during migration.
    if (event.surfaceOp === undefined) {
      for (const node of nodes) replacedBy.set(node.seq, seq);
      replacements.set(seq, nodes.map(node => node.seq));
      nodes.splice(0, nodes.length, { seq, event }); continue;
    }
    const op = event.surfaceOp, sources = event.sourceEventSeqs;
    if (!op || op.op !== 'replace' || !sequence(op.startSeq) || !sequence(op.endSeq) || op.startSeq >= seq || op.endSeq >= seq) throw Error('摘要替换必须指向已存在的早期事件');
    if (!Array.isArray(sources) || !sources.length || new Set(sources).size !== sources.length || sources.some(source => !sequence(source) || source >= seq)) throw Error('摘要必须记录无重复、完整的早期来源序号');
    const start = nodes.findIndex(node => node.seq === op.startSeq), end = nodes.findIndex(node => node.seq === op.endSeq);
    if (start < 0 || end < start) throw Error('摘要替换区间不在当前模型视图中');
    const removed = nodes.slice(start, end + 1);
    if (removed.some(node => !sources.includes(node.seq))) throw Error('摘要来源没有覆盖全部被替换的事件');
    for (const node of removed) replacedBy.set(node.seq, seq);
    replacements.set(seq, removed.map(node => node.seq));
    nodes.splice(start, end - start + 1, { seq, event });
  }
  return { nodes, replacedBy, replacements };
}
