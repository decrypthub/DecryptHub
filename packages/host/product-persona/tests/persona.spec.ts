/** The role definition becomes a system-prompt section and follows settings updates. */
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { expect, it, onTestFinished } from 'vitest'
import * as productPersona from '../src/index.ts'

/** Settings state the stub serves for this namespace. */
interface StubState {
  persona: string
}

/**
 * Compose the prompt service with a settings stub serving this namespace.
 * @param persona - initial role text.
 * @returns context and mutable stub state.
 */
async function fixture(persona: string): Promise<{ ctx: Context; state: StubState }> {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  const state: StubState = { persona }
  ctx.provide('settings', {
    configure: () => () => undefined,
    describe: () => [{ ns: 'product-persona', value: state, revision: 1, applies: 'live', autoGenerate: true, schema: {} }],
    mutate: async () => undefined,
  } as never)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(productPersona, { persona })
  return { ctx, state }
}

it('injects the configured role text into the assembled prompt', async () => {
  const { ctx } = await fixture('你是 DecryptHub 的分析助手，回答用中文。')
  const assembly = await ctx.systemPrompt.assemble({})
  const text = assembly.sections.map(section => section.text).join('\n')
  expect(text).toContain('你是 DecryptHub 的分析助手')
})

it('contributes nothing when the role text is empty', async () => {
  const { ctx } = await fixture('   ')
  const assembly = await ctx.systemPrompt.assemble({})
  const persona = assembly.sections.find(section => section.name === 'product-persona')
  expect(persona?.text.trim() ?? '').toBe('')
})
