// UI disclosure only. Never compress or rewrite the model's conversation history.
// 与 DeepSeek Harness 一致：每轮的执行过程统一收成一行摘要，运行中或需要用户处理时才展开。
export function processPresentation(turn) {
  const attention = ['failed', 'cancelled', 'stopped', 'needs_attention', 'waiting_approval', 'waiting_user'].includes(turn.status);
  return { foldable: true, defaultOpen: !!turn.active || attention };
}
