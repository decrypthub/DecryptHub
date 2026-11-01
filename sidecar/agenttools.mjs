// 交给模型自己决定的两件事：
//   ask_user        —— 向用户提问（含「要不要按这个计划做」）
//   compact_context —— 主动压缩上下文
//
// 这两个以前是「模式」或「阈值」替模型做的决定。现在把判断权交回去：
// 模式只保留标准/危险两档，管的是「哪些操作要用户点头」；计划与压缩由模型按情况决定。
import { object, str, arr } from './contract.mjs';

// 与 DSH skippedAnswerGuidance 对齐：跳过是「用户不要这条信息」，不是「用户授权你自行决定」。
// 这三种结局必须分别说清，否则模型会把跳过当成许可，进而去执行需要审批的操作。
export const ASK_OUTCOME = Object.freeze({
  answered: '用户已回答。把这条回答当作本次任务的有效输入使用。',
  skipped: '用户明确跳过了这个问题：不要复用这条信息，不要重复问同一个问题，'
    + '也不要把它当成授权。继续不需要这条信息的部分；如果某一步确实必须它才能做，'
    + '说明缺什么并停下来等用户，不要自行选择替代方案去做需要审批的操作。',
  'timed-out': '等待超时，用户还没回答（不是跳过）：可以先做互不影响的工作。'
    + '用户之后仍可回答，届时会作为新的用户消息到达。不要把超时当成授权。',
  cancelled: '提问被中断（用户停止，或这一轮是自动化）：不要沿这一支继续，也不要重新提问。',
});

function askResult(outcome) {
  const status = outcome?.status;
  const text = String(outcome?.answer ?? '').trim();
  if (status === 'answered' && text) return { text: `用户回答：${text}\n${ASK_OUTCOME.answered}`, isError: false };
  const known = Object.prototype.hasOwnProperty.call(ASK_OUTCOME, status) ? status : 'skipped';
  const question = String(outcome?.question || '').trim();
  return {
    text: `【提问结果：${known}】${question ? '问题：' + question + '\n' : ''}${ASK_OUTCOME[known]}`,
    isError: false,
  };
}

async function askUser(a, ctx) {
  if (!ctx.ask) return { text: '当前界面不支持提问，请直接按你的判断继续。', isError: false };
  const question = String(a.question || '').trim();
  if (!question) return { text: '需要 question', isError: true };
  const options = (Array.isArray(a.options) ? a.options : []).map(String).filter(Boolean).slice(0, 6);
  const kind = a.kind === 'plan' ? 'plan' : 'question';
  const outcome = await ctx.ask({ question, options, kind, detail: a.detail ? String(a.detail).slice(0, 2000) : '' });
  return askResult(typeof outcome === 'string' ? { status: outcome.trim() ? 'answered' : 'skipped', answer: outcome } : outcome);
}

async function compactContext(a, ctx) {
  if (!ctx.compact) return { text: '当前上下文不支持主动压缩。', isError: true };
  const r = await ctx.compact({ instructions: String(a.instructions || '').slice(0, 500), reason: 'manual' });
  if (!r?.ok) {
    // 「历史太少」不是错误，只是没必要压缩
    return { text: `没有压缩：${r?.error || '原因未知'}。继续当前步骤即可。`, isError: false };
  }
  if (r.stage === 'prune') return { text: `已收起旧的工具输出：${r.before} → ${r.after} tokens（没有调用模型）。` };
  return { text: `已压缩上下文：${r.before} → ${r.after} tokens。被压缩的旧对话已整理成检查点，最近的消息保持原文。` };
}

export const AGENT_TOOLS = [
  {
    name: 'ask_user',
    description: '向用户提问并等待回答（会弹在界面上）。用于：关键方向需要用户拍板、要确认一份计划、需要用户提供只有他知道的信息（账号、目标接口、业务背景）。一次只问一个明确的问题，能自己查证的不要问。kind=plan 表示在确认计划，界面会同时展示任务清单。'
      + '用户点「跳过」表示他不要提供这条信息：不要重复问同一个问题，也不要把跳过当成授权去自行执行需要审批的操作；超时则代表还没回答，用户可以稍后补答。',
    schema: object({
      question: str('要问用户的问题，一句话说清楚，不要写成多选题长文'),
      detail: str('补充说明或背景，可多行'),
      options: arr(str('选项'), '可选的快捷选项（最多 6 个），用户也可以自由输入'),
      kind: str({ enum: ['question', 'plan'], desc: 'plan = 正在请用户确认计划' }),
    }, ['question']),
    run: askUser,
  },
  {
    name: 'compact_context',
    description: '主动压缩上下文：把较早的对话整理成结构化检查点，保留最近的关键内容。适合在长任务告一段落、准备切换子问题时调用。注意：系统会在接近窗口上限时自动兜底压缩，所以这里只在「你判断压一下更有利」时调用，不必每步都压。',
    schema: object({
      instructions: str('压缩时希望重点保留什么，例如「sign 算法的结论与抓包样本」'),
    }),
    run: compactContext,
  },
];
