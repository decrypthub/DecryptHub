/** The skill authoring tools write, list, and delete real skill bundles. */
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { executeModelToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import * as skillManage from '../src/index.ts'

/**
 * Compose the tool stack over a temporary skill root.
 * @returns context and the root directory.
 */
async function fixture(): Promise<{ ctx: Context; root: string }> {
  const root = mkdtempSync(join(tmpdir(), 'dsh-skill-manage-'))
  onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(skillManage, { directory: root })
  return { ctx, root }
}

/**
 * Call one tool through the selected executor.
 * @param ctx - fixture context.
 * @param name - tool name.
 * @param args - tool arguments.
 * @returns the settled result value.
 */
async function call(ctx: Context, name: string, args: unknown): Promise<unknown> {
  const result = await executeModelToolFixture(ctx, {
    callId: ToolCallId(`call-${name}`),
    name,
    arguments: args,
    signal: new AbortController().signal,
  })
  return result.value
}

it('writes a skill bundle with frontmatter and lists it', async () => {
  const { ctx, root } = await fixture()
  const created = await call(ctx, 'skill_create', {
    name: 'release-checklist',
    description: 'Use when preparing a release.',
    body: '- run the gates\n- tag the commit',
  }) as { name: string; path: string }
  expect(existsSync(created.path)).toBe(true)
  const content = readFileSync(join(root, 'release-checklist', 'SKILL.md'), 'utf8')
  expect(content).toContain('name: release-checklist')
  expect(content).toContain('description: Use when preparing a release.')
  expect(content).toContain('- run the gates')
  const listed = await call(ctx, 'skill_list', {}) as { skills: { name: string; description: string }[] }
  expect(listed.skills).toEqual([{ name: 'release-checklist', description: 'Use when preparing a release.' }])
})

it('keeps the stored skill when a create without overwrite is refused', async () => {
  const { ctx } = await fixture()
  await call(ctx, 'skill_create', { name: 'dup', description: 'first', body: 'a' })
  await call(ctx, 'skill_create', { name: 'dup', description: 'second', body: 'b' })
  const kept = await call(ctx, 'skill_list', {}) as { skills: { description: string }[] }
  expect(kept.skills[0]?.description).toBe('first')
  await call(ctx, 'skill_create', { name: 'dup', description: 'second', body: 'b', overwrite: true })
  const replaced = await call(ctx, 'skill_list', {}) as { skills: { description: string }[] }
  expect(replaced.skills[0]?.description).toBe('second')
})

it('deletes a stored skill', async () => {
  const { ctx, root } = await fixture()
  await call(ctx, 'skill_create', { name: 'temporary', description: 'x', body: 'y' })
  const removed = await call(ctx, 'skill_delete', { name: 'temporary' }) as { removed: boolean }
  expect(removed.removed).toBe(true)
  expect(existsSync(join(root, 'temporary'))).toBe(false)
})

it('refuses a non-kebab-case name without creating a directory', async () => {
  const { ctx, root } = await fixture()
  await call(ctx, 'skill_create', { name: 'Bad Name', description: 'x', body: 'y' })
  expect(existsSync(join(root, 'Bad Name'))).toBe(false)
})
