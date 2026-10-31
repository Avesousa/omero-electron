// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { DeviceSession, getDeviceSession, resetDeviceSession } from './device-session'
import { DeviceState } from './device-state'
import type { DeviceClient, DeviceFailure } from './device-client'

const T = '724c4579-ea83-4cef-9f37-bcfbfcc12268'
const ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const user = { id: 'u', name: 'Ana', email: 'a@x.com', role: 'omero-admin', tenantId: T, permissions: ['VENTAS_VER'] }
const failure = (code: string, status = 401): DeviceFailure => ({ ok: false, code, status, message: code })

function make(over: { secrets?: Record<string, unknown>; client?: Partial<Record<'refresh' | 'syncToken' | 'logout', unknown>>; persist?: string } = {}) {
  const notify = vi.fn()
  const state = new DeviceState(
    { OMERO_DEVICE_ID: ID, OMERO_DEVICE_PERSIST: over.persist ?? '1', OMERO_DEVICE_SECRETS: JSON.stringify(over.secrets ?? { [T]: { secret: 'S1', sessionActive: true } }) },
    notify,
  )
  const client = {
    refresh: vi.fn(async () => ({ ok: true, accessToken: 'JWT2', expiresIn: 3600, deviceSecret: 'S2', deviceExpiresAt: 'x', user })),
    syncToken: vi.fn(async () => ({ ok: true, accessToken: 'SYNC', expiresIn: 3600 })),
    logout: vi.fn(async () => ({ ok: true })),
    ...over.client,
  }
  const sink = { remember: vi.fn() }
  const session = new DeviceSession({ state, client: client as unknown as DeviceClient, sink })
  return { session, state, client, sink, notify }
}

describe('refresh', () => {
  it('renueva: guarda el secreto ROTADO (y avisa a Electron) y deja el JWT en el syncer', async () => {
    const { session, state, sink, notify, client } = make()
    const r = await session.refresh(T)
    expect(r).toEqual({ ok: true, accessToken: 'JWT2', expiresIn: 3600, user })
    expect(client.refresh).toHaveBeenCalledWith('S1')
    expect(state.get(T)).toEqual({ secret: 'S2', sessionActive: true })
    expect(notify).toHaveBeenCalledWith({ type: 'omero:device-secrets', secrets: { [T]: { secret: 'S2', sessionActive: true } } })
    expect(sink.remember).toHaveBeenCalledWith(T, 'Bearer JWT2')
  })

  it('los permisos efectivos del usuario viajan en cada rotación (no se congelan hasta el relogin del cajero)', async () => {
    const refreshedUser = { ...user, permissions: ['VENTAS_VER', 'DISPOSITIVOS_VER'] }
    const { session } = make({ client: { refresh: vi.fn(async () => ({ ok: true, accessToken: 'JWT2', expiresIn: 3600, deviceSecret: 'S2', deviceExpiresAt: 'x', user: refreshedUser })) } })
    const r = await session.refresh(T)
    expect(r.ok && r.user.permissions).toEqual(['VENTAS_VER', 'DISPOSITIVOS_VER'])
  })

  it('un solo refresh en vuelo por tenant (el secreto rota: dos concurrentes se pisarían)', async () => {
    let release!: () => void
    const refresh = vi.fn(() => new Promise((res) => (release = () => res({ ok: true, accessToken: 'J', expiresIn: 1, deviceSecret: 'S2', deviceExpiresAt: '', user }))))
    const { session } = make({ client: { refresh } })
    const a = session.refresh(T)
    const b = session.refresh(T.toUpperCase())
    expect(a).toBe(b)
    release()
    expect((await a).ok).toBe(true)
    expect(refresh).toHaveBeenCalledTimes(1)
    refresh.mockImplementation(async () => ({ ok: false, code: 'UNAVAILABLE', status: 0, message: '' }) as never)
    await session.refresh(T) // ya terminó: se puede pedir otra
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('sin caja del tenant → NO_DEVICE; con sesión cerrada → LOGIN_REQUIRED (sin llamar al backend)', async () => {
    const { session, client } = make({ secrets: { [T]: { secret: 'S1', sessionActive: false } } })
    expect(await session.refresh(T)).toMatchObject({ ok: false, code: 'LOGIN_REQUIRED' })
    expect(await session.refresh('99999999-2222-3333-4444-555555555555')).toMatchObject({ ok: false, code: 'NO_DEVICE' })
    expect(client.refresh).not.toHaveBeenCalled()
  })

  it.each(['DEVICE_REVOKED', 'DEVICE_EXPIRED'])('%s se informa y CONSERVA el secreto (para el sync-token)', async (code) => {
    const { session, state } = make({ client: { refresh: vi.fn(async () => failure(code, 403)) } })
    expect(await session.refresh(T)).toMatchObject({ ok: false, code })
    expect(state.get(T)?.secret).toBe('S1')
  })

  it('LOGIN_REQUIRED del backend marca la sesión como cerrada (no insiste)', async () => {
    const { session, state, client } = make({ client: { refresh: vi.fn(async () => failure('LOGIN_REQUIRED')) } })
    await session.refresh(T)
    expect(state.get(T)?.sessionActive).toBe(false)
    await session.refresh(T)
    expect(client.refresh).toHaveBeenCalledTimes(1)
  })

  it('DEVICE_SECRET_INVALID descarta el secreto inservible', async () => {
    const { session, state } = make({ client: { refresh: vi.fn(async () => failure('DEVICE_SECRET_INVALID')) } })
    expect(await session.refresh(T)).toMatchObject({ code: 'DEVICE_SECRET_INVALID' })
    expect(state.get(T)).toBeNull()
  })

  it('UNAVAILABLE y códigos desconocidos → UNAVAILABLE (reintentable) sin tocar el estado', async () => {
    const { session, state } = make({ client: { refresh: vi.fn(async () => failure('UNAVAILABLE', 0)) } })
    expect(await session.refresh(T)).toMatchObject({ code: 'UNAVAILABLE' })
    const other = make({ client: { refresh: vi.fn(async () => failure('HTTP_400', 400)) } })
    expect(await other.session.refresh(T)).toMatchObject({ code: 'UNAVAILABLE' })
    expect(state.get(T)?.secret).toBe('S1')
  })

  it('sin sink no falla', async () => {
    const state = new DeviceState({ OMERO_DEVICE_ID: ID, OMERO_DEVICE_SECRETS: JSON.stringify({ [T]: { secret: 'S1' } }) }, vi.fn())
    const client = { refresh: vi.fn(async () => ({ ok: true, accessToken: 'J', expiresIn: 1, deviceSecret: 'S2', deviceExpiresAt: '', user })) }
    expect((await new DeviceSession({ state, client: client as unknown as DeviceClient }).refresh(T)).ok).toBe(true)
  })
})

describe('syncToken', () => {
  it('devuelve el token de solo subida sin rotar el secreto', async () => {
    const { session, state } = make()
    expect(await session.syncToken(T)).toEqual({ ok: true, accessToken: 'SYNC', expiresIn: 3600 })
    expect(state.get(T)?.secret).toBe('S1')
  })
  it('sin caja → NO_DEVICE; ventana cerrada se informa; secreto inválido se descarta', async () => {
    expect(await make({ secrets: {} }).session.syncToken(T)).toMatchObject({ code: 'NO_DEVICE' })
    expect(await make({ client: { syncToken: vi.fn(async () => failure('SYNC_WINDOW_CLOSED', 403)) } }).session.syncToken(T)).toMatchObject({ code: 'SYNC_WINDOW_CLOSED' })
    const bad = make({ client: { syncToken: vi.fn(async () => failure('DEVICE_SECRET_INVALID')) } })
    await bad.session.syncToken(T)
    expect(bad.state.get(T)).toBeNull()
  })
})

describe('logout', () => {
  it('marca la sesión cerrada, conserva el secreto y avisa al backend', async () => {
    const { session, state, client } = make()
    await session.logout(T)
    expect(state.get(T)).toEqual({ secret: 'S1', sessionActive: false })
    expect(client.logout).toHaveBeenCalledWith('S1')
  })
  it('sin caja no hace nada', async () => {
    const { session, client } = make({ secrets: {} })
    await session.logout(T)
    expect(client.logout).not.toHaveBeenCalled()
  })
})

describe('singleton', () => {
  it('getDeviceSession devuelve siempre el mismo', () => {
    expect(getDeviceSession()).toBe(getDeviceSession())
    resetDeviceSession()
  })
  it('state usa el DeviceState global si no se inyecta', () => {
    expect(new DeviceSession().state.enabled).toBeDefined()
  })
})
