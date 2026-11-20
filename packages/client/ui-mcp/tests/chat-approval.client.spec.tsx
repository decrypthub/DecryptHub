// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import type { ApprovalCardInput } from '@deepseek-ai/dsh-client-ui-approval/client'
import { createWaterfallRequest, PendingQuestion } from '@deepseek-ai/dsh-client-ui-user-questions/src/client/contract/slots.ts'
import { afterEach, expect, it, vi } from 'vitest'
import { McpChatApproval, selectMcpChatApproval } from '../src/client/McpChatApproval.tsx'

type SessionId = ConstructorParameters<typeof PendingQuestion>[0]
type Question = PendingQuestion['questions'][number]

const config = '{\n  "command": "npx",\n  "args": ["-y", "example-mcp", "a  b"]\n}'
const question: Question = {
  id: 'add-mcp-server', question: 'Add this MCP server?', detail: config,
  intent: { kind: 'approval', approve: 'Add and connect', reject: 'Cancel', display: {
    question: { en: 'Add this MCP server?', zh: '添加此 MCP 服务？' },
    detail: { en: config, zh: `这会运行本地程序。\n${config}` },
    approve: { en: 'Add and connect', zh: '添加并连接' },
  } },
}

afterEach(cleanup)

it.each(['onAllow', 'onReject'] as const)('shows the exact proposed settings and forwards %s once', async (action) => {
  const pending = new PendingQuestion('chat' as SessionId, [question])
  const request = createWaterfallRequest(undefined, undefined, () => {})
  pending.attachWaterfall(request.channel)
  const factory = vi.fn((_name: string, _input: ApprovalCardInput) => null)
  render(<McpChatApproval {...{
    matched: selectMcpChatApproval(pending)!,
    renderFactorySlot: factory,
    resolveText: text => text.zh ?? text.en,
  } as Parameters<typeof McpChatApproval>[0]} />)
  const [name, card] = factory.mock.calls[0]!
  expect(name).toBe('conversation.approval.card')
  expect(card).toMatchObject({ title: '添加此 MCP 服务？', description: `这会运行本地程序。\n${config}`, allowLabel: '添加并连接' })
  expect(card.onAlways).toBeUndefined()
  await card[action]()
  expect(await request.result).toEqual({ answers: [{ id: question.id, selected: [action === 'onAllow' ? 'Add and connect' : 'Cancel'] }] })
  pending.close()
  expect(card.canAnswer()).toBe(false)
})

it('leaves other pending questions with their existing renderers', () => {
  expect(selectMcpChatApproval(new PendingQuestion('chat' as SessionId, [{ ...question, id: 'other' }]))).toBeNull()
})
