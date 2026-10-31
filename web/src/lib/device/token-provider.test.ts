// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { getTokenProvider, RENEW_MARGIN_MS, resetTokenProvider, TokenProvider } from './token-provider'
import type { DeviceSession } from './device-session'

const T = '724c4579-ea83-4cef-9f37-bcfbfcc12268'
const NOW = Date.parse('2026-02-01T10:00:00Z')
const jwt = (expInMs: number) => {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
  return `Bearer ${b64({ alg: 'HS256' })}.${b64({ tenantId: T, exp: Math.floor((NOW + expInMs) / 1000) })}.sig`
}

function make(opts: { live?: string | null; enabled?: boolean; refresh?: unknown; sync?: unknown } = {}) {
  const session = {
    state: { enabled: opts.enabled ?? true },
    refresh: vi.fn(async () => opts.refresh ?? { ok: true, accessToken: 'NEW', expiresIn: 3600, user: {} }),
    syncToken: vi.fn(async () => opts.sync ?? { ok: true, accessToken: 'SYNC', expiresIn: 3600 }),
  }
  const syncer = { getAuthorization: vi.fn(() => (opts.live === undefined ? null : opts.live)), forget: vi.fn() }
  const wire = vi.fn()
  let now = NOW
  const provider = new TokenProvider({ syncer, session: session as unknown as DeviceSession, now: () => now, wire })
  return { provider, session, syncer, wire, tick: (ms: number) => (now += ms) }
}

describe('TokenProvider.authorize', () => {
  it('1. usa el JWT pos vigente del syncer sin llamar al backend', async () => {
    const live = jwt(30 * 60_000)
    const { provider, session } = make({ live })
    expect(await provider.authorize(T)).toEqual({ ok: true, authorization: live, kind: 'pos' })
    expect(session.refresh).not.toHaveBeenCalled()
  })

  it('2. si vence en < 2 min renueva con la caja y devuelve el JWT pos nuevo', async () => {
    const { provider, session, wire } = make({ live: jwt(RENEW_MARGIN_MS - 1000) })
    expect(await provider.authorize(T)).toEqual({ ok: true, authorization: 'Bearer NEW', kind: 'pos' })
    expect(session.refresh).toHaveBeenCalledWith(T)
    expect(wire).toHaveBeenCalled()
  })

  it('sin JWT en el syncer (reinicio) renueva con la caja', async () => {
    expect((await make({ live: null }).provider.authorize(T))).toMatchObject({ ok: true, authorization: 'Bearer NEW', kind: 'pos' })
  })

  it('un JWT sin exp se considera vigente', async () => {
    const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
    const noExp = `Bearer ${b64({ alg: 'x' })}.${b64({ tenantId: T })}.sig`
    expect(await make({ live: noExp }).provider.authorize(T)).toMatchObject({ authorization: noExp })
  })

  it.each(['DEVICE_REVOKED', 'DEVICE_EXPIRED', 'LOGIN_REQUIRED'])('3. %s → token de solo subida (sync)', async (code) => {
    const { provider, session } = make({ live: null, refresh: { ok: false, code, message: code } })
    expect(await provider.authorize(T)).toEqual({ ok: true, authorization: 'Bearer SYNC', kind: 'sync' })
    expect(session.syncToken).toHaveBeenCalledWith(T)
  })

  it('el token sync se cachea hasta 2 min antes de vencer', async () => {
    const { provider, session, tick } = make({ live: null, refresh: { ok: false, code: 'DEVICE_REVOKED', message: '' } })
    await provider.authorize(T)
    await provider.authorize(T)
    expect(session.syncToken).toHaveBeenCalledTimes(1)
    tick(3600_000 - RENEW_MARGIN_MS + 1000) // ya casi vence
    await provider.authorize(T)
    expect(session.syncToken).toHaveBeenCalledTimes(2)
  })

  it('un refresh exitoso descarta el token sync cacheado', async () => {
    const { provider, session } = make({ live: null, refresh: { ok: false, code: 'LOGIN_REQUIRED', message: '' } })
    await provider.authorize(T)
    session.refresh.mockResolvedValueOnce({ ok: true, accessToken: 'NEW2', expiresIn: 3600, user: {} } as never)
    expect(await provider.authorize(T)).toMatchObject({ authorization: 'Bearer NEW2', kind: 'pos' })
    session.refresh.mockResolvedValue({ ok: false, code: 'DEVICE_REVOKED', message: '' } as never)
    await provider.authorize(T)
    expect(session.syncToken).toHaveBeenCalledTimes(2) // el cacheado se descartó
  })

  it('4. ventana de subida cerrada o sin caja → unauthorized', async () => {
    expect(await make({ live: null, refresh: { ok: false, code: 'DEVICE_REVOKED', message: '' }, sync: { ok: false, code: 'SYNC_WINDOW_CLOSED', message: '' } }).provider.authorize(T)).toEqual({ ok: false, reason: 'unauthorized' })
    expect(await make({ live: null, refresh: { ok: false, code: 'NO_DEVICE', message: '' } }).provider.authorize(T)).toEqual({ ok: false, reason: 'unauthorized' })
    expect(await make({ live: null, refresh: { ok: false, code: 'DEVICE_SECRET_INVALID', message: '' } }).provider.authorize(T)).toEqual({ ok: false, reason: 'unauthorized' })
  })

  it('sin red para renovar → unavailable (el sender reintenta, no es un problema de credenciales)', async () => {
    expect(await make({ live: null, refresh: { ok: false, code: 'UNAVAILABLE', message: '' } }).provider.authorize(T)).toEqual({ ok: false, reason: 'unavailable' })
    expect(await make({ live: null, refresh: { ok: false, code: 'DEVICE_REVOKED', message: '' }, sync: { ok: false, code: 'UNAVAILABLE', message: '' } }).provider.authorize(T)).toEqual({ ok: false, reason: 'unavailable' })
  })

  it('sin red pero con un JWT que aún no venció, lo usa hasta el final', async () => {
    const live = jwt(RENEW_MARGIN_MS - 1000)
    expect(await make({ live, refresh: { ok: false, code: 'UNAVAILABLE', message: '' } }).provider.authorize(T)).toMatchObject({ ok: true, authorization: live })
  })

  it('sin caja (web / backend viejo): como antes — el token del syncer o unauthorized', async () => {
    const live = jwt(RENEW_MARGIN_MS - 1000)
    expect(await make({ live, enabled: false }).provider.authorize(T)).toMatchObject({ ok: true, authorization: live })
    expect(await make({ live: null, enabled: false }).provider.authorize(T)).toEqual({ ok: false, reason: 'unauthorized' })
  })

  it('invalidate olvida el token sync y el del syncer', async () => {
    const { provider, session, syncer } = make({ live: null, refresh: { ok: false, code: 'DEVICE_REVOKED', message: '' } })
    await provider.authorize(T)
    provider.invalidate(T)
    expect(syncer.forget).toHaveBeenCalledWith(T)
    await provider.authorize(T)
    expect(session.syncToken).toHaveBeenCalledTimes(2)
  })

  it('singleton', () => {
    expect(getTokenProvider()).toBe(getTokenProvider())
    resetTokenProvider()
  })

  it('valores por defecto (syncer, sesión, reloj, wiring)', async () => {
    const p = new TokenProvider()
    expect(await p.authorize(T)).toEqual({ ok: false, reason: 'unauthorized' }) // sin caja en este proceso
    p.invalidate(T)
  })
})
