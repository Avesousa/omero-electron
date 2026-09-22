// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { DeviceClient } from './device-client'

const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200 })
const err = (status: number, code?: string, error = 'x') => new Response(JSON.stringify({ success: false, error, ...(code ? { code } : {}) }), { status })
const user = { id: 'u', name: 'Ana', email: 'a@x.com', role: 'ADMIN', tenantId: 't' }

const client = (fetchFn: unknown) => new DeviceClient({ fetchFn: fetchFn as typeof fetch, backendUrl: () => 'https://b.test' })

describe('DeviceClient', () => {
  it('refresh: manda solo el secreto y devuelve token, secreto rotado y usuario', async () => {
    const f = vi.fn(async () => ok({ accessToken: 'JWT', expiresIn: 3600, deviceSecret: 'S2', deviceExpiresAt: '2026-10-05T00:00:00Z', user }))
    const r = await client(f).refresh('S1')
    expect(r).toEqual({ ok: true, accessToken: 'JWT', expiresIn: 3600, deviceSecret: 'S2', deviceExpiresAt: '2026-10-05T00:00:00Z', user })
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://b.test/api/auth/device/refresh')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ deviceSecret: 'S1' })
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('syncToken y logout', async () => {
    const f = vi.fn(async (u: string) => (u.endsWith('sync-token') ? ok({ accessToken: 'SYNC', expiresIn: 60 }) : ok(null)))
    expect(await client(f).syncToken('S')).toEqual({ ok: true, accessToken: 'SYNC', expiresIn: 60 })
    expect(await client(f).logout('S')).toEqual({ ok: true })
  })

  it.each([
    [401, 'LOGIN_REQUIRED'], [401, 'DEVICE_EXPIRED'], [403, 'DEVICE_REVOKED'], [401, 'DEVICE_SECRET_INVALID'], [403, 'SYNC_WINDOW_CLOSED'],
  ])('%i %s → falla tipada con el código del backend', async (status, code) => {
    const r = await client(vi.fn(async () => err(status, code, 'mensaje'))).refresh('S')
    expect(r).toEqual({ ok: false, status, code, message: 'mensaje' })
  })

  it('4xx sin code → HTTP_<status>', async () => {
    expect(await client(vi.fn(async () => err(400))).refresh('S')).toMatchObject({ ok: false, code: 'HTTP_400' })
    expect(await client(vi.fn(async () => new Response('', { status: 403 }))).syncToken('S')).toMatchObject({ code: 'HTTP_403', message: 'Error 403' })
  })

  it('red caída, timeout y 5xx → UNAVAILABLE (reintentable)', async () => {
    expect(await client(vi.fn(async () => { throw new TypeError('fetch failed') })).refresh('S')).toEqual({ ok: false, status: 0, code: 'UNAVAILABLE', message: 'Sin conexión con el servidor' })
    expect(await client(vi.fn(async () => err(502))).refresh('S')).toMatchObject({ code: 'UNAVAILABLE', status: 502 })
    expect(await client(vi.fn(async () => new Response('<html>', { status: 503 }))).syncToken('S')).toMatchObject({ code: 'UNAVAILABLE', message: 'Error 503' })
  })

  it('200 con cuerpo inválido o incompleto → UNAVAILABLE', async () => {
    expect(await client(vi.fn(async () => new Response('no json', { status: 200 }))).refresh('S')).toMatchObject({ code: 'UNAVAILABLE' })
    expect(await client(vi.fn(async () => ok({ accessToken: 'x' }))).refresh('S')).toMatchObject({ code: 'UNAVAILABLE' })
    expect(await client(vi.fn(async () => ok({}))).syncToken('S')).toMatchObject({ code: 'UNAVAILABLE' })
    expect(await client(vi.fn(async () => new Response(JSON.stringify({ success: false }), { status: 200 }))).syncToken('S')).toMatchObject({ code: 'UNAVAILABLE' })
  })

  it('valores por defecto de expiresIn y deviceExpiresAt', async () => {
    const r = await client(vi.fn(async () => ok({ accessToken: 'J', deviceSecret: 'S2', user }))).refresh('S')
    expect(r).toMatchObject({ ok: true, expiresIn: 3600, deviceExpiresAt: '' })
    expect(await client(vi.fn(async () => ok({ accessToken: 'J' }))).syncToken('S')).toMatchObject({ expiresIn: 3600 })
  })

  it('usa fetch/BACKEND_URL/timeout por defecto', async () => {
    vi.stubEnv('BACKEND_URL', 'https://envb.test')
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(err(401, 'DEVICE_REVOKED'))
    await new DeviceClient().refresh('S')
    expect(String(spy.mock.calls[0][0])).toBe('https://envb.test/api/auth/device/refresh')
    spy.mockRestore()
    vi.unstubAllEnvs()
  })
})
