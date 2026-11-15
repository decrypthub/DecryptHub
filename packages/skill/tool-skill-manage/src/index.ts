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

/** Bookkeeping file naming the skills this tool created. */
const MANIFEST = '.created-by-agent.json'

/**
 * Read the names this tool owns. A missing or malformed manifest counts as
 * empty: the tool must never treat an unowned skill as its own.
 * @param root - writable skill root.
 * @returns owned skill names.
 */
async function readManifest(root: string): Promise<Set<string>> {
  try {
    const document = JSON.parse(await readFile(join(root, MANIFEST), 'utf8')) as { skills?: unknown }
    return new Set(Array.isArray(document.skills) ? document.skills.filter((item): item is string => typeof item === 'string') : [])
  } catch {
    // A corrupt manifest must not unlock user-authored skills.
    return new Set()
  }
}

/**
 * Record one skill name as tool-owned.
 * @param root - writable skill root.
 * @param name - kebab-case skill name.
 */
async function remember(root: string, name: string): Promise<void> {
  const skills = await readManifest(root)
  if (skills.has(name)) return
  skills.add(name)
  await writeFile(join(root, MANIFEST), `${JSON.stringify({ skills: [...skills].sort() }, null, 2)}\n`)
}

/**
 * Drop one skill name from the owned set.
 * @param root - writable skill root.
 * @param name - kebab-case skill name.
 */
async function forget(root: string, name: string): Promise<void> {
  const skills = await readManifest(root)
  if (!skills.delete(name)) return
  await writeFile(join(root, MANIFEST), `${JSON.stringify({ skills: [...skills].sort() }, null, 2)}\n`)
}

/**
 * Render one skill bundle body with its frontmatter. The description is a
 * JSON-quoted YAML scalar so a colon or `#` cannot silently corrupt the
 * frontmatter the catalog parser reads.
 * @param name - kebab-case skill name.
 * @param description - one-line discovery text.
 * @param body - instruction markdown.
 * @returns the complete `SKILL.md` content.
 */
function renderSkill(name: string, description: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${body.trim()}\n`
}

/**
 * Read the description out of a stored `SKILL.md`.
 * @param path - absolute file path.
 * @returns the description, or an empty string when the file has none.
 */
async function readDescription(path: string): Promise<string> {
  const text = await readFile(path, 'utf8')
  const raw = /^description:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? ''
  if (!raw.startsWith('"')) return raw
  try {
    const value: unknown = JSON.parse(raw)
    return typeof value === 'string' ? value : ''
  } catch {
    // A hand-written value that merely starts with a quote stays verbatim.
    return raw
  }
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
      if (/[\r\n]/.test(args.description)) throw new Error('skill_create: description must be one line')
      const directory = join(root, args.name)
      const path = join(directory, 'SKILL.md')
      const exists = await stat(directory).then(() => true, () => false)
      if (exists) {
        if (args.overwrite !== true) throw new Error(`skill_create: skill "${args.name}" already exists; pass overwrite to replace it`)
        const owned = await readManifest(root)
        if (!owned.has(args.name)) {
          throw new Error(`skill_create: skill "${args.name}" was created outside this tool; choose another name or ask the user to remove it first`)
        }
      }
      await mkdir(directory, { recursive: true })
      await writeFile(path, renderSkill(args.name, args.description, args.body), 'utf8')
      await remember(root, args.name)
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
      if (exists) {
        const owned = await readManifest(root)
        if (!owned.has(args.name)) {
          throw new Error(`skill_delete: skill "${args.name}" was created outside this tool; ask the user to remove it`)
        }
        await rm(directory, { recursive: true, force: true })
        await forget(root, args.name)
      }
      return { removed: exists }
    },
  }))
}
