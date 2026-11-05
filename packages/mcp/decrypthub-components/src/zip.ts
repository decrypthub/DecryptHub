/** Link-free, bounded extraction adapted from the existing desktop component installer. */
import { createWriteStream, promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'
import type { Readable } from 'node:stream'
import { componentPath } from './files.ts'

/**
 * Extract only ordinary files and directories into an owned empty stage.
 * @param archive - verified ZIP file.
 * @param root - empty owned extraction directory.
 * @param signal - installation lifetime.
 * @returns after complete extraction and closure.
 */
export async function extractComponentZip(archive: string, root: string, signal: AbortSignal): Promise<void> {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.open(archive, { lazyEntries: true, validateEntrySizes: true }, (error, file) => {
      if (error) reject(error)
      else resolve(file)
    })
  })
  await new Promise<void>((resolve, reject) => {
    let settled = false
    let ended = false
    let work: Promise<void> | undefined
    const lifetime = new AbortController()
    let entries = 0
    let bytes = 0
    const abort = (): void => { fail(new Error('Component extraction cancelled')) }
    const fail = (error: unknown): void => {
      if (settled) return
      settled = true; signal.removeEventListener('abort', abort); lifetime.abort(); zip.close()
      void Promise.allSettled(work ? [work] : []).then(() => { reject(error instanceof Error ? error : new Error(String(error))) })
    }
    signal.addEventListener('abort', abort, { once: true })
    zip.on('error', fail)
    zip.on('end', () => { ended = true })
    zip.on('close', () => {
      if (settled) return
      if (!ended) { fail(new Error('Component ZIP closed before extraction completed')); return }
      settled = true; signal.removeEventListener('abort', abort); resolve()
    })
    zip.on('entry', (entry: yauzl.Entry) => {
      work = (async () => {
        lifetime.signal.throwIfAborted()
        if (++entries > 50_000 || (bytes += entry.uncompressedSize) > 1024 ** 3 || entry.uncompressedSize > 512 * 1024 ** 2) throw new Error('Component ZIP exceeds extraction limits')
        const mode = entry.externalFileAttributes >>> 16
        const type = mode & 0o170000
        if (type && type !== 0o100000 && type !== 0o040000) throw new Error('Component ZIP contains links or special files')
        const directory = entry.fileName.endsWith('/')
        const target = await componentPath(root, directory ? entry.fileName.slice(0, -1) : entry.fileName)
        if (directory) await fs.mkdir(target, { recursive: true })
        else {
          await fs.mkdir(dirname(target), { recursive: true })
          const stream = await new Promise<Readable>((resolveStream, rejectStream) => {
            zip.openReadStream(entry, (error, stream) => {
              if (error) rejectStream(error)
              else resolveStream(stream)
            })
          })
          await pipeline(stream, createWriteStream(target, { flags: 'wx', mode: 0o600 }), { signal: lifetime.signal })
        }
      })()
      void work.then(() => { if (!settled) zip.readEntry() }, fail)
    })
    if (signal.aborted) abort()
    else zip.readEntry()
  })
}
