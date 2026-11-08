/**
 * Scaffold a product-owned package and register it at the three sanctioned mounting points.
 *
 * The product adds capability on top of the upstream tree: everything it owns lives in a new
 * package, and the only upstream files it touches are the registration surfaces every package
 * needs. This generator writes those files as LF without a byte-order mark and appends one
 * entry per registration surface, so a new customization cannot drift from that rule.
 *
 * @module scripts/new-product-package
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const REPOSITORY_ROOT = resolve(import.meta.dirname, '..')
const BUNDLE_ROOT = join(REPOSITORY_ROOT, 'packages', 'bundle', 'web-app')
const HOST_TSCONFIG = join(REPOSITORY_ROOT, 'tsconfig.host.json')

/** Package roles the generator can scaffold. */
type PackageKind = 'tool' | 'plugin'

/** Locale metadata written for every supported client locale. */
const LOCALES: Readonly<Record<string, { title: string; description: string }>> = {
  en: { title: 'TITLE_EN', description: 'DESCRIPTION_EN.' },
  zh: { title: 'TITLE_ZH', description: 'DESCRIPTION_ZH。' },
  de: { title: 'TITLE_DE', description: 'DESCRIPTION_DE.' },
  es: { title: 'TITLE_ES', description: 'DESCRIPTION_ES.' },
  fr: { title: 'TITLE_FR', description: 'DESCRIPTION_FR.' },
  ja: { title: 'TITLE_JA', description: 'DESCRIPTION_JA。' },
  pt: { title: 'TITLE_PT', description: 'DESCRIPTION_PT.' },
  ru: { title: 'TITLE_RU', description: 'DESCRIPTION_RU.' },
}

/** Parsed command-line options. */
interface Options {
  readonly name: string
  readonly kind: PackageKind
  readonly group: string
  readonly description: string
  readonly dryRun: boolean
}

/**
 * Read and validate the command line.
 * @returns Validated options.
 */
function readOptions(): Options {
  const { values } = parseArgs({
    options: {
      name: { type: 'string' },
      kind: { type: 'string', default: 'tool' },
      group: { type: 'string', default: 'experimental' },
      description: { type: 'string', default: 'Product package.' },
      'dry-run': { type: 'boolean', default: false },
    },
  })
  const name = values.name
  if (name === undefined || name.trim() === '') throw new Error('new-product-package: --name is required')
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error('new-product-package: --name must be kebab-case')
  const kind = values.kind
  if (kind !== 'tool' && kind !== 'plugin') throw new Error('new-product-package: --kind must be tool or plugin')
  const group = values.group
  if (!/^[a-z][a-z0-9-]*$/.test(group)) throw new Error('new-product-package: --group must be a package group directory')
  return { name, kind, group, description: values.description, dryRun: values['dry-run'] }
}

/**
 * Render the plugin entry point for the requested kind.
 * @param name - Plugin and package suffix.
 * @param kind - Package role.
 * @returns TypeScript source for `src/index.ts`.
 */
function renderSource(name: string, kind: PackageKind): string {
  const header = `/**\n * PLACEHOLDER: state the contract this plugin owns.\n * @module @deepseek-ai/dsh-${name}\n */\n\nimport type { Context } from '@deepseek-ai/cordis'\n`
  if (kind === 'tool') {
    return `${header}import { defineTool } from '@deepseek-ai/dsh-tools'

/** Cordis plugin name. */
export const name = '${name}'
/** Services used by the plugin. */
export const inject = ['tools']

/**
 * Register the model-facing tool for this composition.
 * @param ctx - context providing the tool registry.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'PLACEHOLDER_TOOL_NAME',
    description: 'PLACEHOLDER: state when the model should call this tool, using task terms only.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { text: { type: 'string', required: true, description: 'PLACEHOLDER result field.' } },
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute() {
      return { text: 'PLACEHOLDER' }
    },
  }))
}
`
  }
  return `${header}import type {} from '@deepseek-ai/dsh-agent'

/** Cordis plugin name. */
export const name = '${name}'
/** Services used by the plugin. */
export const inject: readonly string[] = []

/**
 * Apply the plugin to this composition.
 * @param ctx - context this plugin contributes to.
 */
export function apply(ctx: Context): void {
  // Register on a documented extension point, then delete this comment.
  void ctx
}
`
}

/**
 * Render a bilingual README pair.
 * @param packageName - Published package name.
 * @param description - One-line English summary.
 * @returns English and Chinese README bodies.
 */
function renderReadmes(packageName: string, description: string): { en: string; zh: string } {
  const en = `---
description: "${description}"
kind: "package-reference"
---

# ${packageName}

English | [中文](README.zh.md)

## Summary

PLACEHOLDER: state what this package contributes and what it does not own.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)

<a id="use-this-package"></a>

## Use this package

PLACEHOLDER: mount instructions and configuration fields.

<a id="model-experience"></a>

## Model Experience

PLACEHOLDER: state what the model sees, the token effect, and the KV-cache effect.
`
  const zh = `---
description: "${description}"
kind: "package-reference"
---

# ${packageName}

[English](README.md) | 中文

## 摘要

待补：说明本包贡献什么、不拥有什么。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)

<a id="use-this-package"></a>

## 使用本包

待补：挂载方式与配置字段。

<a id="model-experience"></a>

## 模型体验

待补：模型看到什么、token 影响、KV 缓存影响。
`
  return { en, zh }
}

/**
 * Write one file, creating parent directories and never emitting a BOM.
 * @param path - Absolute destination path.
 * @param body - File content using LF line endings.
 * @param dryRun - Whether to report instead of writing.
 */
function write(path: string, body: string, dryRun: boolean): void {
  const relative = path.slice(REPOSITORY_ROOT.length + 1)
  if (existsSync(path)) throw new Error(`new-product-package: refusing to overwrite ${relative}`)
  console.log(`${dryRun ? 'would write' : 'wrote'} ${relative}`)
  if (dryRun) return
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, body, 'utf8')
}

/**
 * Insert one line after the opening of a named member, preserving existing line endings.
 * @param path - File to edit.
 * @param anchor - Line content the insertion follows.
 * @param line - Line to insert.
 * @param dryRun - Whether to report instead of writing.
 */
function insertAfter(path: string, anchor: string, line: string, dryRun: boolean): void {
  const text = readFileSync(path, 'utf8')
  const index = text.indexOf(anchor)
  if (index < 0) throw new Error(`new-product-package: anchor not found in ${path}: ${anchor}`)
  if (text.includes(line.trim())) throw new Error(`new-product-package: ${path} already registers this package`)
  const at = index + anchor.length
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const updated = `${text.slice(0, at)}${eol}${line}${text.slice(at)}`
  console.log(`${dryRun ? 'would register' : 'registered'} in ${path.slice(REPOSITORY_ROOT.length + 1)}`)
  if (!dryRun) writeFileSync(path, updated, 'utf8')
}

/**
 * Append a bundle patch row that mounts the package in the web profile.
 * @param id - Cordis row id.
 * @param packageName - Package name the row mounts.
 * @param dryRun - Whether to report instead of writing.
 */
function appendBundleRow(id: string, packageName: string, dryRun: boolean): void {
  const path = join(BUNDLE_ROOT, 'cordis.patch.yml')
  const text = readFileSync(path, 'utf8')
  if (text.includes(id)) throw new Error('new-product-package: bundle patch already mounts this row')
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const block = `${eol}# Product row: ${id}.${eol}- insert:${eol}    - id: ${id}${eol}      name: '${packageName}'${eol}`
  console.log(`${dryRun ? 'would mount' : 'mounted'} ${id} in packages/bundle/web-app/cordis.patch.yml`)
  if (!dryRun) writeFileSync(path, `${text.trimEnd()}${eol}${block}`, 'utf8')
}

const options = readOptions()
const packageName = `@deepseek-ai/dsh-${options.name}`
const packageDir = join(REPOSITORY_ROOT, 'packages', options.group, options.name)
const manifest = {
  name: packageName,
  description: options.description,
  version: '0.2.2-rc.1',
  private: true,
  type: 'module',
  main: 'lib/index.js',
  types: 'lib/types/index.d.ts',
  exports: {
    '.': { types: './lib/types/index.d.ts', default: './lib/index.js' },
    './src/*': './src/*',
    './locale/*.json': './locale/*.json',
    './package.json': './package.json',
  },
  files: ['locale/*.json', 'lib/index.js', 'lib/types/**/*.d.ts'],
  license: 'MIT',
  peerDependencies: {
    '@deepseek-ai/cordis': 'workspace:~',
    '@deepseek-ai/dsh-tools': 'workspace:*',
  },
  devDependencies: {
    '@deepseek-ai/cordis': 'workspace:~',
    '@deepseek-ai/dsh-tools': 'workspace:*',
  },
}
const tsconfig = {
  extends: '../../../tsconfig.base.json',
  compilerOptions: { rootDir: 'src', outDir: 'lib/types' },
  include: ['src'],
  references: [{ path: '../../../vendor/cordis' }, { path: '../../core/tools' }],
}

write(join(packageDir, 'package.json'), `${JSON.stringify(manifest, undefined, 2)}\n`, options.dryRun)
write(join(packageDir, 'tsconfig.json'), `${JSON.stringify(tsconfig, undefined, 2)}\n`, options.dryRun)
write(join(packageDir, 'src', 'index.ts'), renderSource(options.name, options.kind), options.dryRun)
const readmes = renderReadmes(packageName, options.description)
write(join(packageDir, 'README.md'), readmes.en, options.dryRun)
write(join(packageDir, 'README.zh.md'), readmes.zh, options.dryRun)
for (const [locale, meta] of Object.entries(LOCALES)) {
  write(join(packageDir, 'locale', `${locale}.json`), `${JSON.stringify({ meta }, undefined, 2)}\n`, options.dryRun)
}

insertAfter(HOST_TSCONFIG, '"references": [', `    { "path": "./packages/${options.group}/${options.name}" },`, options.dryRun)
insertAfter(join(BUNDLE_ROOT, 'package.json'), '"dependencies": {', `    "${packageName}": "workspace:*",`, options.dryRun)
appendBundleRow(options.name, packageName, options.dryRun)

console.log(`
next:
  pnpm install --no-frozen-lockfile
  pnpm run gen-tsconfig-paths
  pnpm exec tsx scripts/verify-translation-pairing.ts --write packages/${options.group}/${options.name}/README.md
  pnpm run build:artifacts
`)
