/** Real console events reach asynchronous JavaScript shutdown in Electron Node mode. */

import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import ts from 'typescript'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const execute = promisify(execFile)
const require = createRequire(import.meta.url)
const suiteTimeout = 90_000
let unavailable: string | undefined
let root: string | undefined
let probe: string
let electron: string
let entry: string

describe.skipIf(process.platform !== 'win32')('Windows Electron console signals', () => {
  beforeAll(async () => {
    const programFiles = process.env['ProgramFiles(x86)']
    const shell = process.env.ComSpec
    if (programFiles === undefined || shell === undefined) {
      unavailable = 'Windows compiler environment is unavailable'
      return
    }
    const vswhere = join(programFiles, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
    if (!existsSync(vswhere)) {
      unavailable = 'Visual Studio C++ build tools are unavailable'
      return
    }
    const vs = (await execute(vswhere, ['-latest', '-products', '*', '-requires',
      'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], {
      timeout: 10_000, windowsHide: true,
    })).stdout.trim()
    const vcvars = join(vs, 'VC/Auxiliary/Build/vcvars64.bat')
    if (vs === '' || !existsSync(vcvars)) {
      unavailable = 'Visual Studio C++ x64 toolchain is unavailable'
      return
    }
    if (!process.env.ELECTRON_OVERRIDE_DIST_PATH && !existsSync(join(dirname(require.resolve('electron')), 'path.txt'))) {
      unavailable = 'Electron runtime is unavailable'
      return
    }
    electron = require('electron') as string
    if (!existsSync(electron)) {
      unavailable = 'Electron executable is unavailable'
      return
    }

    // Electron's Node entry must resolve the fixture and write its readiness marker.
    // The Windows AppData temp path can deny Electron's file lookup on this host.
    const temporary = join(import.meta.dirname, '../../../.tmp')
    await mkdir(temporary, { recursive: true })
    root = await mkdtemp(join(temporary, 'dsh-cli-console-'))
    const quote = (value: string) => '"' + value.replaceAll('%', '%%') + '"'
    probe = join(root, 'console-probe.exe')
    const compile = join(root, 'compile.cmd')
    await writeFile(compile, ['@echo off', 'call ' + quote(vcvars) + ' >nul',
      'if errorlevel 1 exit /b %errorlevel%',
      'cl /nologo /std:c++17 /EHsc /MT /W4 /WX ' + quote(join(import.meta.dirname, 'fixtures/cli-console-probe.cpp'))
        + ' /Fo' + quote(join(root, 'console.obj')) + ' /Fe' + quote(probe), '',
    ].join('\r\n'))
    await execute(shell, ['/d', '/v:off', '/c', 'compile.cmd'], { cwd: root, timeout: 45_000, windowsHide: true })
    // Only TypeScript is erased; the child has no source-loader hook that could change signal handling.
    const source = await readFile(new URL('../../desktop-host/src/windows-cli-signals.ts', import.meta.url), 'utf8')
    const code = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText
      .replace(/(['"])koffi\1/u, JSON.stringify(pathToFileURL(require.resolve('koffi')).href))
    await writeFile(join(root, 'signals.mjs'), code)
    entry = join(root, 'entry.mjs')
    await writeFile(entry, [
      "import { writeFileSync } from 'node:fs'",
      "import { writeFile } from 'node:fs/promises'",
      "import { installWindowsCliSignals } from './signals.mjs'",
      'await installWindowsCliSignals()',
      'const [marker, ready] = process.argv.slice(2)',
      "for (const [signal, code] of [['SIGINT',130],['SIGBREAK',131]]) process.on(signal, async () => {",
      '  await writeFile(marker, signal); process.exit(code)',
      '})',
      "writeFileSync(ready, 'ready')",
      'setInterval(() => {}, 1000)', '',
    ].join('\n'))
  }, suiteTimeout)

  afterAll(async () => {
    if (root === undefined) return
    await chmod(root, 0o700)
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it.for(['SIGINT', 'SIGBREAK'] as const)(
    'delivers %s before process exit', { timeout: suiteTimeout }, async (signal, test) => {
      if (unavailable !== undefined) test.skip(unavailable)
      if (root === undefined) throw new Error('Console fixture is not prepared')
      const marker = join(root, signal + '.txt')
      const ready = join(root, signal + '.ready')
      const report = join(root, signal + '.report')
      const event = signal === 'SIGINT' ? '0' : '1'
      let failure: unknown
      try { await execute(probe, [electron, entry, marker, ready, report, event], { timeout: 40_000, windowsHide: true }) }
      catch (error) { failure = error }
      const observed = existsSync(report) ? await readFile(report, 'utf8') : 'Console probe exited before reporting.'
      expect(failure, observed).toBeUndefined()
      expect(await readFile(marker, 'utf8')).toBe(signal)
    },
  )
})
