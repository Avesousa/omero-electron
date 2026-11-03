// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { DeviceSession, getDeviceSession, resetDeviceSession } from './device-session'
import { DeviceState } from './device-state'
import type { DeviceClient, DeviceFailure } from './device-client'

const T = '724c4579-ea83-4cef-9f37-bcfbfcc12268'
const ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const user = { id: 'u', name: 'Ana', email: 'a@x.com', role: 'omero-admin', tenantId: T, permissions: ['VENTAS_VER'] }
const NOW = Date.parse('2026-03-01T10:00:00Z')
const failure = (code: string, status = 401): DeviceFailure => ({ ok: false, code, status, message: code })

function make(over: { secrets?: Record<string, unknown>; client?: Partial<Record<'refresh' | 'syncToken' | 'logout', unknown>>; persist?: string; durable?: (m: unknown) => Promise<boolean> } = {}) {
  const notify = vi.fn()
  const durable = vi.fn(over.durable ?? (async () => true))
  const state = new DeviceState(
    { OMERO_DEVICE_ID: ID, OMERO_DEVICE_PERSIST: over.persist ?? '1', OMERO_DEVICE_SECRETS: JSON.stringify(over.secrets ?? { [T]: { secret: 'S1', sessionActive: true } }) },
    notify,
    durable,
    () => NOW,
  )
  const client = {
    refresh: vi.fn(async () => ({ ok: true, accessToken: 'JWT2', expiresIn: 3600, deviceSecret: 'S2', deviceExpiresAt: 'x', user })),
    syncToken: vi.fn(async () => ({ ok: true, accessToken: 'SYNC', expiresIn: 3600 })),
    logout: vi.fn(async () => ({ ok: true })),
    ...over.client,
  }
  const sink = { remember: vi.fn() }
  const session = new DeviceSession({ state, client: client as unknown as DeviceClient, sink, now: () => NOW })
  return { session, state, client, sink, notify, durable }
}

describe('refresh', () => {
  it('renueva: guarda el secreto ROTADO (y avisa a Electron) y deja el JWT en el syncer', async () => {
    const { session, state, sink, notify, client } = make()
    const r = await session.refresh(T)
    expect(r).toEqual({ ok: true, accessToken: 'JWT2', expiresIn: 3600, user, sessionExpiresAt: null })
    expect(client.refresh).toHaveBeenCalledWith('S1')
    expect(state.get(T)).toEqual({ secret: 'S2', sessionActive: true, lastCheckedAt: NOW })
    expect(notify).not.toHaveBeenCalled() // la persistencia va por el camino durable (con ack), no por el debounce
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

describe('renovación: persistencia atómica del secreto y fin definitivo', () => {
  it('el secreto NUEVO se persiste (y se espera el ack) ANTES de entregar el JWT / avisar', async () => {
    const order: string[] = []
    const { session, sink, durable } = make({ durable: async (m) => { order.push(`durable:${JSON.stringify((m as { secrets: Record<string, { secret: string }> }).secrets[T].secret)}`); return true } })
    sink.remember.mockImplementation(() => order.push('sink'))
    await session.refresh(T)
    expect(order).toEqual(['durable:"S2"', 'sink'])
    expect(durable).toHaveBeenCalledTimes(1)
    expect((durable.mock.calls[0][0] as { ackId?: string }).ackId).toBeTruthy()
  })

  it('guarda lastCheckedAt y el vencimiento de 14 días que informa el backend', async () => {
    const exp = '2026-03-15T10:00:00Z'
    const { session, state } = make({ client: { refresh: vi.fn(async () => ({ ok: true, accessToken: 'J', expiresIn: 3600, deviceSecret: 'S2', deviceExpiresAt: exp, user })) } })
    const r = await session.refresh(T)
    expect(r.ok && r.sessionExpiresAt).toBe(Date.parse(exp))
    expect(state.get(T)).toMatchObject({ secret: 'S2', lastCheckedAt: NOW, expiresAt: Date.parse(exp) })
  })

  it('si el ack no llega igual sigue (el secreto queda en memoria y se reintenta persistir por el debounce)', async () => {
    const { session, notify, state } = make({ durable: async () => false })
    expect((await session.refresh(T)).ok).toBe(true)
    expect(state.get(T)?.secret).toBe('S2')
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('una falla de red NO toca el secreto ni persiste nada (la sesión de 14 días sigue vigente)', async () => {
    const { session, state, durable, notify } = make({ client: { refresh: vi.fn(async () => failure('UNAVAILABLE', 0)) } })
    expect(await session.refresh(T)).toMatchObject({ ok: false, code: 'UNAVAILABLE' })
    expect(state.get(T)).toEqual({ secret: 'S1', sessionActive: true })
    expect(durable).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
    expect(state.endedReason(T)).toBeNull()
  })

  it.each(['DEVICE_REVOKED', 'DEVICE_EXPIRED', 'LOGIN_REQUIRED'] as const)('%s deja la sesión marcada como terminada', async (code) => {
    const { session, state } = make({ client: { refresh: vi.fn(async () => failure(code, 403)) } })
    await session.refresh(T)
    expect(state.endedReason(T)).toBe(code)
  })

  it('revocada/vencida: no vuelve a llamar al backend hasta un nuevo login', async () => {
    const { session, state, client } = make({ client: { refresh: vi.fn(async () => failure('DEVICE_REVOKED', 403)) } })
    await session.refresh(T)
    expect(await session.refresh(T)).toMatchObject({ ok: false, code: 'DEVICE_REVOKED', message: expect.stringMatching(/revocada/) })
    expect(client.refresh).toHaveBeenCalledTimes(1)
    state.set(T, 'S9', true) // nuevo login
    expect(state.endedReason(T)).toBeNull()
  })

})

describe('validador pasivo (validateIfDue)', () => {
  const H = 3600_000
  let clock: number
  function mk(over: Parameters<typeof make>[0] = {}, lastCheckedAt: number | null = NOW - 25 * H, expiresAt: number | null = NOW + 10 * 24 * H) {
    const secrets = { [T]: { secret: 'S1', sessionActive: true, ...(lastCheckedAt ? { lastCheckedAt } : {}), ...(expiresAt ? { expiresAt } : {}) } }
    const m = make({ secrets, ...over })
    clock = NOW
    const session = new DeviceSession({ state: m.state, client: m.client as unknown as DeviceClient, sink: m.sink, now: () => clock })
    return { ...m, session }
  }

  it('pasaron >= 24 h: renueva en ese momento (secreto rotado, lastCheckedAt = ahora, +14 días)', async () => {
    const exp = '2026-03-15T10:00:00Z'
    const m = mk({ client: { refresh: vi.fn(async () => ({ ok: true, accessToken: 'J', expiresIn: 3600, deviceSecret: 'S2', deviceExpiresAt: exp, user })) } })
    await m.session.validateIfDue(T)
    expect(m.client.refresh).toHaveBeenCalledWith('S1')
    expect(m.state.get(T)).toEqual({ secret: 'S2', sessionActive: true, lastCheckedAt: NOW, expiresAt: Date.parse(exp) })
  })

  it('exactamente 24 h también valida', async () => {
    const m = mk({}, NOW - 24 * H)
    await m.session.validateIfDue(T)
    expect(m.client.refresh).toHaveBeenCalledTimes(1)
  })

  it('antes de 24 h NO valida', async () => {
    const m = mk({}, NOW - 24 * H + 1000)
    await m.session.validateIfDue(T)
    expect(m.client.refresh).not.toHaveBeenCalled()
  })

  it('sin fecha de validación (secreto de una versión anterior) valida', async () => {
    const m = mk({}, null)
    await m.session.validateIfDue(T)
    expect(m.client.refresh).toHaveBeenCalledTimes(1)
  })

  it('falla TRANSITORIA: no se toca el secreto ni se corta nada, y se posterga 24 h (sin reintentos)', async () => {
    const m = mk({ client: { refresh: vi.fn(async () => failure('UNAVAILABLE', 0)) } })
    await m.session.validateIfDue(T)
    expect(m.state.get(T)).toMatchObject({ secret: 'S1', sessionActive: true, lastCheckedAt: NOW, expiresAt: NOW + 10 * 24 * H })
    expect(m.state.endedReason(T)).toBeNull()
    await m.session.validateIfDue(T)
    clock = NOW + 23 * H
    await m.session.validateIfDue(T)
    expect(m.client.refresh).toHaveBeenCalledTimes(1)
    clock = NOW + 24 * H
    await m.session.validateIfDue(T)
    expect(m.client.refresh).toHaveBeenCalledTimes(2)
  })

  it('14 días sin una renovación exitosa: la sesión se cierra (DEVICE_EXPIRED) sin llamar al backend', async () => {
    const m = mk({}, NOW - 25 * H, NOW - 1000)
    expect(m.state.endedReason(T)).toBe('DEVICE_EXPIRED')
    await m.session.validateIfDue(T)
    expect(m.client.refresh).not.toHaveBeenCalled()
    expect(await m.session.refresh(T)).toMatchObject({ ok: false, code: 'DEVICE_EXPIRED', message: 'Esta caja estuvo 14 días sin conectarse. Ingresá de nuevo.' })
    expect(m.state.get(T)?.secret).toBe('S1') // se conserva para el sync-token
  })

  it.each(['DEVICE_REVOKED', 'DEVICE_EXPIRED', 'LOGIN_REQUIRED'] as const)('error definitivo %s: termina la sesión y conserva el secreto', async (code) => {
    const m = mk({ client: { refresh: vi.fn(async () => failure(code, 403)) } })
    await m.session.validateIfDue(T)
    expect(m.state.endedReason(T)).toBe(code)
    expect(m.state.get(T)?.secret).toBe('S1')
    await m.session.validateIfDue(T)
    expect(m.client.refresh).toHaveBeenCalledTimes(1)
  })

  it('sin caja, sesión cerrada o con la sesión ya terminada: no hace nada', async () => {
    expect((await (async () => { const m = mk({ secrets: {} }); await m.session.validateIfDue(T); return m.client.refresh })()).mock.calls).toHaveLength(0)
    const closed = mk({ secrets: { [T]: { secret: 'S1', sessionActive: false } } })
    await closed.session.validateIfDue(T)
    expect(closed.client.refresh).not.toHaveBeenCalled()
  })

  it('single-flight: varias operaciones a la vez comparten UN solo refresh', async () => {
    let release!: () => void
    const refresh = vi.fn(() => new Promise((res) => (release = () => res({ ok: true, accessToken: 'J', expiresIn: 1, deviceSecret: 'S2', deviceExpiresAt: '', user }))))
    const m = mk({ client: { refresh } })
    const ops = [m.session.validateIfDue(T), m.session.validateIfDue(T), m.session.refresh(T), m.session.validateIfDue(T.toUpperCase())]
    await Promise.resolve()
    release()
    await Promise.all(ops)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('la renovación OBLIGATORIA (JWT vencido / 401) no depende de las 24 h: refresh siempre llama al backend', async () => {
    const m = mk({}, NOW - 1 * H) // validada hace 1 h
    expect((await m.session.refresh(T)).ok).toBe(true)
    expect(m.client.refresh).toHaveBeenCalledTimes(1)
    expect(m.state.get(T)?.lastCheckedAt).toBe(NOW) // y de paso extiende los 14 días
  })

  it('una excepción inesperada no sale del validador', async () => {
    const m = mk({ client: { refresh: vi.fn(async () => { throw new Error('boom') }) } })
    await expect(m.session.validateIfDue(T)).resolves.toBeUndefined()
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
