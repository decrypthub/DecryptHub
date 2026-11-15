/** Render DecryptHub application, tray and installer artwork from the owned crow vector. */
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { packIco, TRAY_ICON_PATHS, TRAY_ICON_SIZES } from './render-tray-icon.ts'

const resources = new URL('../resources/', import.meta.url)
const assets = new URL('../installer/assets/', import.meta.url)
const source = await readFile(new URL('icon.svg', resources))

for (const name of ['icon', 'icon-windows', 'icon-macos']) {
  if (name !== 'icon') await writeFile(new URL(`${name}.svg`, resources), source)
  await sharp(source).resize(1024, 1024).png().toFile(fileURLToPath(new URL(`${name}.png`, resources)))
}
// Keep the complete crow inside the tile at small sizes; the upstream whale zoom clips its beak.
const tray = await Promise.all(TRAY_ICON_SIZES.map(async size => ({
  size, png: await sharp(source).resize(size, size).png().toBuffer(),
})))
await writeFile(TRAY_ICON_PATHS.output, packIco(tray))

/**
 * Rasterize and tightly crop the existing installer wordmark at its requested height.
 * @param {number} height - Wordmark height in pixels.
 * @param {string} fill - Theme-specific wordmark color.
 * @returns {Promise<{ buffer: Buffer, width: number }>} Cropped artwork and width.
 */
async function wordmark(height, fill) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2880" height="480"><text x="0" y="374.4" font-family="Segoe UI, Segoe UI Variable Display, Arial" font-size="316.8" font-weight="650" letter-spacing="-2" fill="${fill}">DecryptHub</text></svg>`
  const rendered = await sharp(Buffer.from(svg)).png().toBuffer()
  const { data, info } = await sharp(rendered).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let left = info.width, top = info.height, right = -1, bottom = -1
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * info.channels + 3] <= 16) continue
      left = Math.min(left, x); right = Math.max(right, x)
      top = Math.min(top, y); bottom = Math.max(bottom, y)
    }
  }
  if (right < left || bottom < top) throw new Error('Product icon: wordmark did not render')
  const buffer = await sharp(rendered).extract({ left, top, width: right - left + 1, height: bottom - top + 1 })
    .resize({ height, kernel: 'lanczos3' }).png().toBuffer()
  return { buffer, width: (await sharp(buffer).metadata()).width }
}

for (const scale of [1, 2]) {
  const width = 600 * scale, height = 196 * scale, badge = 120 * scale
  for (const theme of ['light', 'dark']) {
    const word = await wordmark(scale === 1 ? 23 : 45, theme === 'dark' ? '#f9fafb' : '#0f1115')
    const name = `brand${theme === 'dark' ? '-dark' : ''}${scale === 2 ? '-2x' : ''}.png`
    await sharp({ create: { width, height, channels: 4, background: '#00000000' } }).composite([
      { input: await sharp(source).resize(badge, badge).png().toBuffer(), left: (width - badge) / 2, top: 16 * scale },
      { input: word.buffer, left: Math.round((width - word.width) / 2), top: 163 * scale },
    ]).png().toFile(fileURLToPath(new URL(name, assets)))
  }
}
await sharp({ create: { width: 164, height: 314, channels: 4, background: '#f3f4f6' } }).composite([
  { input: await sharp(source).resize(120, 120).png().toBuffer(), left: 22, top: 90 },
]).png().toFile(fileURLToPath(new URL('uninstaller-sidebar.png', assets)))
console.info('Product icons: application, seven tray sizes, both installer themes and uninstaller rendered')
