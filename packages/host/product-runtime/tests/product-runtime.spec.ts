/** The product runtime tool reports process-level facts through the shared tool pipeline. */
import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime, type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { executeModelToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import { expect, it, onTestFinished } from 'vitest'
import * as productRuntime from '../src/index.ts'

/**
 * Compose the minimal Host tool stack the plugin needs.
 * @returns Context with the plugin mounted.
 */
async function fixture(): Promise<Context> {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(productRuntime)
  return ctx
}

it('registers the product_runtime tool with a model-facing description', async () => {
  const ctx = await fixture()
  const definition = ctx.tools.get('product_runtime')
  expect(definition).toBeDefined()
  expect(definition?.description).toContain('DecryptHub')
})

it('reports the harness home, platform, and Node version', async () => {
  const ctx = await fixture()
  const before = process.env.DSH_HOME
  process.env.DSH_HOME = '/tmp/product-runtime-spec'
  onTestFinished(() => {
    if (before === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = before
  })
  const result: ToolExecutionResult = await executeModelToolFixture(ctx, {
    callId: ToolCallId('call-product-runtime'),
    name: 'product_runtime',
    arguments: {},
    signal: new AbortController().signal,
  })
  expect(result.value).toMatchObject({
    product: 'DecryptHub',
    home: '/tmp/product-runtime-spec',
    platform: expect.stringMatching(/^[a-z0-9]+-[a-z0-9]+$/),
    node: expect.stringMatching(/^\d+\./),
  })
})
