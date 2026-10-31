// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeviceState, getDeviceState, notifyParent, readIdentity, resetDeviceState } from './device-state'

const T1 = '724c4579-ea83-4cef-9f37-bcfbfcc12268'
const T2 = '11111111-2222-3333-4444-555555555555'
const ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const env = (over: Record<string, string | undefined> = {}) => ({
  OMERO_DEVICE_ID: ID,
  OMERO_DEVICE_NAME: 'MOSTRADOR',
  OMERO_DEVICE_PLATFORM: 'win32',
  OMERO_APP_VERSION: '1.2.3',
  OMERO_DEVICE_PERSIST: '1',
  OMERO_DEVICE_SECRETS: JSON.stringify({ [T1]: { secret: 'S1', sessionActive: true } }),
  ...over,
})

afterEach(() => {
  resetDeviceState()
  vi.restoreAllMocks()
})

describe('readIdentity', () => {
  it('lee la identidad que pasa Electron', () => {
    expect(readIdentity(env())).toEqual({ deviceId: ID, name: 'MOSTRADOR', platform: 'win32', appVersion: '1.2.3', persist: true })
  })
  it.each([undefined, '', 'no-uuid', '  '])('sin OMERO_DEVICE_ID válido (%j) → null (web / dev)', (v) => {
    expect(readIdentity(env({ OMERO_DEVICE_ID: v }))).toBeNull()
  })
  it('persist solo con "1"; recorta y limita el largo de los textos', () => {
    expect(readIdentity(env({ OMERO_DEVICE_PERSIST: '0' }))!.persist).toBe(false)
    expect(readIdentity(env({ OMERO_DEVICE_PERSIST: undefined }))!.persist).toBe(false)
    const long = readIdentity(env({ OMERO_DEVICE_NAME: ` ${'x'.repeat(300)} `, OMERO_APP_VERSION: undefined }))!
    expect(long.name).toHaveLength(100)
    expect(long.appVersion).toBe('')
  })
})

describe('DeviceState', () => {
  it('carga los secretos del env (tenant normalizado a minúsculas)', () => {
    const s = new DeviceState(env({ OMERO_DEVICE_SECRETS: JSON.stringify({ [T1.toUpperCase()]: { secret: 'S1' } }) }), vi.fn())
    expect(s.enabled).toBe(true)
    expect(s.get(T1)).toEqual({ secret: 'S1', sessionActive: true })
    expect(s.get(T2)).toBeNull()
  })

  it.each([
    ['sin variable', undefined],
    ['JSON inválido', '{no'],
    ['no es objeto', '[1]'],
    ['tenant inválido', JSON.stringify({ 'x': { secret: 's' } })],
    ['secreto vacío', JSON.stringify({ [T1]: { secret: '' } })],
    ['secreto enorme', JSON.stringify({ [T1]: { secret: 'a'.repeat(201) } })],
    ['valor no objeto', JSON.stringify({ [T1]: 'texto', [T2]: null })],
  ])('env %s → sin secretos', (_n, raw) => {
    expect(new DeviceState(env({ OMERO_DEVICE_SECRETS: raw }), vi.fn()).snapshot()).toEqual({})
  })

  it('sin identidad (web) no está habilitado y set() es no-op', () => {
    const notify = vi.fn()
    const s = new DeviceState({ OMERO_DEVICE_SECRETS: JSON.stringify({ [T1]: { secret: 'S1' } }) }, notify)
    expect(s.enabled).toBe(false)
    s.set(T1, 'x')
    expect(s.get(T1)).toBeNull()
    expect(notify).not.toHaveBeenCalled()
  })

  it('set / markLoggedOut / remove avisan al main con el snapshot completo', () => {
    const notify = vi.fn()
    const s = new DeviceState(env(), notify)
    s.set(T2, 'S2')
    expect(notify).toHaveBeenLastCalledWith({
      type: 'omero:device-secrets',
      secrets: { [T1]: { secret: 'S1', sessionActive: true }, [T2]: { secret: 'S2', sessionActive: true } },
    })
    s.markLoggedOut(T1)
    expect(s.get(T1)).toEqual({ secret: 'S1', sessionActive: false })
    s.markLoggedOut(T1) // ya cerrada: no vuelve a avisar
    s.markLoggedOut('99999999-2222-3333-4444-555555555555') // inexistente
    expect(notify).toHaveBeenCalledTimes(2)
    s.remove(T2)
    s.remove(T2)
    expect(notify).toHaveBeenCalledTimes(3)
    expect(Object.keys(s.snapshot())).toEqual([T1])
  })

  it('con persist=0 los cambios quedan solo en memoria (no avisa)', () => {
    const notify = vi.fn()
    const s = new DeviceState(env({ OMERO_DEVICE_PERSIST: '0' }), notify)
    s.set(T2, 'S2')
    expect(s.get(T2)?.secret).toBe('S2')
    expect(notify).not.toHaveBeenCalled()
  })

  it('get devuelve una copia (no se puede mutar el estado desde afuera)', () => {
    const s = new DeviceState(env(), vi.fn())
    const copy = s.get(T1)!
    copy.secret = 'hack'
    expect(s.get(T1)!.secret).toBe('S1')
  })

  it('getDeviceState es un singleton', () => {
    expect(getDeviceState()).toBe(getDeviceState())
  })
})

describe('notifyParent', () => {
  it('fuera de Electron no hace nada', () => {
    expect(() => notifyParent({ type: 'omero:device-secrets', secrets: {} })).not.toThrow()
  })
  it('dentro de un utilityProcess publica por parentPort; si el main murió no rompe', () => {
    const post = vi.fn()
    ;(process as unknown as { parentPort?: unknown }).parentPort = { postMessage: post }
    notifyParent({ type: 'omero:device-secrets', secrets: {} })
    expect(post).toHaveBeenCalledWith({ type: 'omero:device-secrets', secrets: {} })
    post.mockImplementation(() => {
      throw new Error('closed')
    })
    expect(() => notifyParent({ type: 'omero:device-secrets', secrets: {} })).not.toThrow()
    delete (process as unknown as { parentPort?: unknown }).parentPort
  })
})
