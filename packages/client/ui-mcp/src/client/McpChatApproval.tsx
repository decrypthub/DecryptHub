/** Use the shared approval card for a Desktop MCP configuration decision. */
import type { ComposerChainProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsRenderFactories } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-approval/client'
import type {} from '@deepseek-ai/dsh-client-ui-user-questions/client'

/** Match only a pending MCP configuration decision.
 * @param pending - the session's current composer interaction.
 * @returns the request and its approval actions, or null for another interaction. */
export function selectMcpChatApproval(pending: ComposerChainProps['pendingInteraction']) {
  if (pending?.kind !== 'question' || pending.questions.length !== 1) return null
  const item = pending.questions[0]
  if (item?.id !== 'add-mcp-server' || item.intent?.kind !== 'approval') return null
  return { pending, item, intent: item.intent }
}

type McpChatApprovalProps = PropsRenderFactories & {
  matched: NonNullable<ReturnType<typeof selectMcpChatApproval>>
  resolveText: (text: { en: string; [locale: string]: string }) => string
}

/** Render the exact reviewed configuration and settle the original question.
 * @param props - selected interaction and shared approval renderer.
 * @returns the confirmation card. */
export function McpChatApproval({ matched: { pending, item, intent }, resolveText, renderFactorySlot }: McpChatApprovalProps) {
  const answer = (label: string) => pending.answer({ answers: [{ id: item.id, selected: [label] }] })
  const description = intent.display?.detail === undefined ? item.detail : resolveText(intent.display.detail)
  return renderFactorySlot('conversation.approval.card', {
    requestKey: pending.key,
    title: intent.display === undefined ? item.question : resolveText(intent.display.question),
    ...(description === undefined ? {} : { description }),
    allowLabel: intent.display?.approve === undefined ? intent.approve : resolveText(intent.display.approve),
    canAnswer: () => pending.snapshot().channel !== 'none' && !pending.snapshot().closed,
    onAllow: () => answer(intent.approve),
    onReject: () => answer(intent.reject),
  })
}
