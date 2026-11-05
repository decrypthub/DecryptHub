// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply, inject } from '../src/client/index.ts'
import { ProductBrandMark, ProductBrandName } from '../src/client/Brand.tsx'
import { apply as hostApply } from '../src/index.ts'

afterEach(cleanup)

const HOLES = ['sidebar.brand.mark', 'sidebar.brand.name', 'conversation.hero.brand.mark'] as const

async function bench(declare = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const declareHoles = () => slots.register({
    name: 'root',
    children: Object.fromEntries(HOLES.map(name => [name, { kind: 'single', scope: 'root' }])),
  } as never, () => null)
  const dispose = declare ? declareHoles() : undefined
  return { ctx, slots, declareHoles, dispose }
}

describe('DecryptHub brand occupants', () => {
  it('keeps the Host entry inert and requests only the slot service', () => {
    expect(hostApply).not.toThrow()
    expect(inject).toEqual(['slots'])
  })

  it('registers after declarations appear and releases every occupant on disposal', async () => {
    const subject = await bench(false)
    const fiber = subject.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    for (const hole of HOLES) expect(subject.slots.entries(hole)).toHaveLength(0)
    const dispose = subject.declareHoles()
    await Promise.resolve()
    for (const hole of HOLES) expect(subject.slots.entries(hole)).toHaveLength(1)
    dispose()
    for (const hole of HOLES) expect(subject.slots.entries(hole)).toHaveLength(0)
    subject.declareHoles()
    await Promise.resolve()
    for (const hole of HOLES) expect(subject.slots.entries(hole)).toHaveLength(1)
    await fiber.dispose()
    for (const hole of HOLES) expect(subject.slots.entries(hole)).toHaveLength(0)
  })

  it('renders the product name and embedded existing artwork with the host class', () => {
    const name = render(<ProductBrandName />)
    expect(name.getByText('DecryptHub')).toBeTruthy()
    name.unmount()
    const mark = render(<ProductBrandMark size={24} className="hero-mark" />)
    const image = mark.container.querySelector('img')
    expect(image?.getAttribute('src')).toMatch(/^data:image\/svg\+xml,/)
    expect(image?.getAttribute('class')).toBe('hero-mark')
    expect(image?.getAttribute('alt')).toBe('')
  })
})
