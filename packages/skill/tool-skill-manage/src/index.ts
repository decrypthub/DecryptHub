/**
 * Model-facing skill authoring: create, list, and delete skills under one
 * writable root that `dsh-skill-filesystem` also scans, so a skill the model
 * writes reaches the next catalog without a restart.
 * @module @deepseek-ai/dsh-tool-skill-manage
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import z from '@deepseek-ai/schemastery'

/** Cordis plugin name. */
export const name = 'tool-skill-manage'
/** Services used by the plugin. */
export const inject = ['tools']

/** Where authored skills live. */
export interface Config {
  /** Absolute directory holding one `<name>/SKILL.md` bundle per skill. */
  directory: string
}

/** Validated plugin configuration. */
export const Config = z.object({
  directory: z.string().min(1),
})

/** Skill names are kebab-case so the directory, the catalog id, and `/name` agree. */
const SKILL_NAME = /^[a-z][a-z0-9-]{0,62}$/

/**
 * Render one skill bundle body with its frontmatter.
 * @param name - kebab-case skill name.
 * @param description - one-line discovery text.
 * @param body - instruction markdown.
 * @returns the complete `SKILL.md` content.
 */
function renderSkill(name: string, description: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body.trim()}\n`
}

/**
 * Read the description out of a stored `SKILL.md`.
 * @param path - absolute file path.
 * @returns the description, or an empty string when the file has none.
 */
async function readDescription(path: string): Promise<string> {
  const text = await readFile(path, 'utf8')
  const match = /^description:\s*(.+)$/m.exec(text)
  return match?.[1]?.trim() ?? ''
}

/**
 * Register the skill authoring tools.
 * @param ctx - context providing the tool registry.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const root = config.directory

  ctx.tools.register(defineTool({
    name: 'skill_create',
    description: 'Write a reusable skill: a short name, a one-line description of when to use it, and the markdown instructions. The skill appears in your catalog on the next step. Omit overwrite to refuse replacing an existing skill.',
    parameters: {
      name: { type: 'string', required: true, description: 'Kebab-case skill name, for example release-checklist.' },
      description: { type: 'string', required: true, description: 'One line stating when the model should use this skill.' },
      body: { type: 'string', required: true, description: 'Markdown instructions the skill loads.' },
      overwrite: { type: 'boolean', description: 'Replace an existing skill with the same name. Defaults to false.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', required: true, description: 'Stored skill name.' },
          path: { type: 'string', required: true, description: 'Absolute SKILL.md path.' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `skill ${value.name} saved at ${value.path}` }],
    },
    async execute(args) {
      if (!SKILL_NAME.test(args.name)) throw new Error('skill_create: name must be kebab-case, at most 63 characters')
      const directory = join(root, args.name)
      const path = join(directory, 'SKILL.md')
      if (args.overwrite !== true) {
        const exists = await stat(directory).then(() => true, () => false)
        if (exists) throw new Error(`skill_create: skill "${args.name}" already exists; pass overwrite to replace it`)
      }
      await mkdir(directory, { recursive: true })
      await writeFile(path, renderSkill(args.name, args.description, args.body), 'utf8')
      return { name: args.name, path }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'skill_list',
    description: 'List the skills stored under the writable skill root with their descriptions. Use it before creating a skill to avoid duplicates.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          skills: {
            type: 'array',
            required: true,
            description: 'Stored skills in name order.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                description: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.skills.length === 0
          ? '(no authored skills)'
          : value.skills.map(skill => `${skill.name}: ${skill.description}`).join('\n'),
      }],
    },
    async execute() {
      const names = await readdir(root).catch(() => [] as string[])
      const skills: { name: string; description: string }[] = []
      for (const entry of names) {
        const description = await readDescription(join(root, entry, 'SKILL.md')).catch(() => undefined)
        if (description !== undefined) skills.push({ name: entry, description })
      }
      skills.sort((left, right) => left.name.localeCompare(right.name))
      return { skills }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'skill_delete',
    description: 'Delete one authored skill by name. Use it when the instructions are obsolete or the user asks to remove the skill.',
    parameters: {
      name: { type: 'string', required: true, description: 'Kebab-case skill name returned by skill_list.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { removed: { type: 'boolean', required: true, description: 'Whether a skill was removed.' } },
      },
      render: (_args, value) => [{ type: 'text', text: value.removed ? 'skill removed' : 'no such skill' }],
    },
    async execute(args) {
      if (!SKILL_NAME.test(args.name)) throw new Error('skill_delete: name must be kebab-case, at most 63 characters')
      const directory = join(root, args.name)
      const exists = await stat(directory).then(() => true, () => false)
      if (exists) await rm(directory, { recursive: true, force: true })
      return { removed: exists }
    },
  }))
}
