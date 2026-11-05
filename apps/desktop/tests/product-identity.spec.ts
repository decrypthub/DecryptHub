import { join, resolve } from 'node:path'
import type { App } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyProductIdentity } from '../src/product-identity.ts'
import { resolveDesktopLocale } from '../src/locale.ts'

afterEach(() => vi.unstubAllEnvs())

function application(requested = ''): Pick<App, 'setName' | 'setPath' | 'getPath' | 'commandLine'> {
  return {
    setName: vi.fn(), setPath: vi.fn(), getPath: () => '/app-data',
    commandLine: {
      getSwitchValue: () => requested, appendArgument: vi.fn(), appendSwitch: vi.fn(),
      hasSwitch: () => false, removeSwitch: vi.fn(),
    },
  }
}

describe('DecryptHub Desktop identity', () => {
  it('uses an independent application and runtime directory by default', () => {
    const app = application(), env: NodeJS.ProcessEnv = {}
    applyProductIdentity(app, env)
    expect(app.setName).toHaveBeenCalledWith('DecryptHub')
    expect(app.setPath).toHaveBeenCalledWith('userData', join('/app-data', 'DecryptHub-DSH'))
    expect(env.DSH_HOME).toBe(join('/app-data', 'DecryptHub-DSH', 'runtime'))
  })

  it('honors explicit isolated data and Host locations', () => {
    const app = application('./isolated-data'), env = { DSH_HOME: '/isolated-host' }
    applyProductIdentity(app, env)
    expect(app.setPath).toHaveBeenCalledWith('userData', resolve('./isolated-data'))
    expect(env.DSH_HOME).toBe('/isolated-host')
  })

  it('keeps an empty inherited home inside the product directory', () => {
    const app = application(), env = { DSH_HOME: ' ' }
    applyProductIdentity(app, env)
    expect(env.DSH_HOME).toBe(join('/app-data', 'DecryptHub-DSH', 'runtime'))
  })

  it('uses the built product identity in every Desktop locale', () => {
    vi.stubEnv('DSH_CLIENT_TITLE', 'DecryptHub')
    for (const id of ['en', 'zh', 'ja', 'es', 'fr', 'de', 'ru', 'pt']) {
      const messages = resolveDesktopLocale(id).messages
      expect(messages.aboutProduct).toBe('DecryptHub')
      expect(Object.values(messages).some(value => value.includes('DeepSeek Harness'))).toBe(false)
    }
  })
})
