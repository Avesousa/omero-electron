// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetWiring, validateDevicesOnStart, wireDevice } from './device-wiring'
import { getDeviceSession, resetDeviceSession } from './device-session'
import { resetDeviceState } from './device-state'
import { getSyncer } from '../catalog/syncer'

const T = '724c4579-ea83-4cef-9f37-bcfbfcc12268'
const T2 = '11111111-2222-3333-4444-555555555555'
const ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

function boot(secrets: Record<string, unknown>, id = ID) {
  vi.stubEnv('OMERO_DEVICE_ID', id)
  vi.stubEnv('OMERO_DEVICE_PERSIST', '0')
  vi.stubEnv('OMERO_DEVICE_SECRETS', JSON.stringify(secrets))
  resetDeviceState(); resetDeviceSession(); resetWiring()
}
afterEach(() => {
  getSyncer().setRenewer(null)
  getSyncer().setValidator(null)
  resetDeviceState(); resetDeviceSession(); resetWiring()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('validateDevicesOnStart (arranque)', () => {
  it('valida UNA vez cada caja con sesión activa (el validador decide si pasaron 24 h); no deja timers', () => {
    boot({ [T]: { secret: 'a' }, [T2]: { secret: 'b', sessionActive: false } })
    const spy = vi.spyOn(getDeviceSession(), 'validateIfDue').mockResolvedValue()
    validateDevicesOnStart()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith(T)
  })
  it('sin identidad de caja (web) no hace nada', () => {
    boot({}, '')
    const spy = vi.spyOn(getDeviceSession(), 'validateIfDue').mockResolvedValue()
    validateDevicesOnStart()
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('wireDevice', () => {
  it('el ciclo del syncer que ya existe dispara la validación pasiva', async () => {
    boot({ [T]: { secret: 'a' } })
    const spy = vi.spyOn(getDeviceSession(), 'validateIfDue').mockResolvedValue()
    wireDevice()
    wireDevice() // idempotente
    const syncer = getSyncer()
    syncer.remember(T, `Bearer h.${Buffer.from(JSON.stringify({ tenantId: T, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.s`)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 500 }))
    await syncer.syncAll()
    expect(spy).toHaveBeenCalledWith(T)
  })
})
