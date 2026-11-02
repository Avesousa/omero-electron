// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { endedCodeOf, endedResponse, isEndedCode, reportEndedResponse } from './session-ended'
import { getDeviceSession, resetDeviceSession } from './device-session'
import { getDeviceState, resetDeviceState } from './device-state'
import { resetWiring, wireDevice } from './device-wiring'
import { handleApiRequest } from '../data-layer'
import { CatalogSyncer, getSyncer } from '../catalog/syncer'
import { TokenProvider } from './token-provider'

const T = '724c4579-ea83-4cef-9f37-bcfbfcc12268'
const ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const bearer = (exp = Math.floor(Date.now() / 1000) + 3600) => {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
  return `Bearer ${b64({ alg: 'x' })}.${b64({ tenantId: T, exp })}.s`
}
const forbidden = (code: string) => new Response(JSON.stringify({ success: false, error: 'x', code }), { status: 403, headers: { 'content-type': 'application/json' } })
const req = (path: string, auth = bearer(), method = 'GET') => new Request(`http://localhost:3000${path}`, { method, headers: { authorization: auth, 'content-type': 'application/json' }, ...(method === 'POST' ? { body: '{}' } : {}) })

function boot() {
  vi.stubEnv('OMERO_RUNTIME', 'desktop')
  vi.stubEnv('BACKEND_URL', 'http://127.0.0.1:9')
  vi.stubEnv('OMERO_DEVICE_ID', ID)
  vi.stubEnv('OMERO_DEVICE_PERSIST', '0')
  // validada hace 1 minuto: el gate de 24 h NO debe intervenir en el corte
  vi.stubEnv('OMERO_DEVICE_SECRETS', JSON.stringify({ [T]: { secret: 'S1', sessionActive: true, lastCheckedAt: Date.now() - 60_000 } }))
  resetDeviceState(); resetDeviceSession(); resetWiring()
}
beforeEach(boot)
afterEach(() => {
  getSyncer().setRenewer(null); getSyncer().setValidator(null); getSyncer().forget(T)
  resetDeviceState(); resetDeviceSession(); resetWiring()
  vi.unstubAllEnvs(); vi.restoreAllMocks()
})

describe('helpers', () => {
  it('isEndedCode / endedCodeOf: solo 403 con los tres códigos; no consume el body', async () => {
    expect(isEndedCode('DEVICE_REVOKED') && isEndedCode('DEVICE_EXPIRED') && isEndedCode('LOGIN_REQUIRED')).toBe(true)
    expect(isEndedCode('SUBSCRIPTION_INACTIVE')).toBe(false)
    expect(isEndedCode(undefined)).toBe(false)
    const res = forbidden('DEVICE_REVOKED')
    expect(await endedCodeOf(res)).toBe('DEVICE_REVOKED')
    expect((await res.json()).code).toBe('DEVICE_REVOKED')
    expect(await endedCodeOf(new Response(JSON.stringify({ code: 'DEVICE_REVOKED' }), { status: 401 }))).toBeNull() // 401 NO es fin de sesión
    expect(await endedCodeOf(forbidden('SUBSCRIPTION_INACTIVE'))).toBeNull()
    expect(await endedCodeOf(new Response('no json', { status: 403 }))).toBeNull()
  })
  it('endedResponse: 403 local con code y mensaje en español', async () => {
    const r = endedResponse('DEVICE_REVOKED')
    expect(r.status).toBe(403)
    expect(await r.json()).toMatchObject({ success: false, code: 'DEVICE_REVOKED', error: expect.stringMatching(/revocada/) })
  })
})

describe('DeviceSession.reportEnded / reportEndedResponse', () => {
  it.each(['DEVICE_REVOKED', 'DEVICE_EXPIRED', 'LOGIN_REQUIRED'] as const)('%s: termina la sesión YA y conserva el secreto', async (code) => {
    wireDevice()
    getSyncer().remember(T, bearer())
    expect(await reportEndedResponse(T, forbidden(code))).toBe(code)
    expect(getDeviceState().endedReason(T)).toBe(code)
    expect(getDeviceState().get(T)?.secret).toBe('S1')
    expect(getSyncer().getAuthorization(T)).toBeNull() // el JWT pos se olvida
  })
  it('sin caja del tenant, sin tenant o con otro 403: no hace nada', async () => {
    expect(await reportEndedResponse('99999999-2222-3333-4444-555555555555', forbidden('DEVICE_REVOKED'))).toBe('DEVICE_REVOKED')
    expect(await reportEndedResponse(null, forbidden('DEVICE_REVOKED'))).toBe('DEVICE_REVOKED')
    expect(await reportEndedResponse(T, forbidden('OTRO'))).toBeNull()
    expect(getDeviceState().endedReason(T)).toBeNull()
  })
  it('refresh posterior no llama al backend ni se trata como recuperable', async () => {
    const f = vi.spyOn(globalThis, 'fetch')
    getDeviceSession().reportEnded(T, 'DEVICE_REVOKED')
    expect(await getDeviceSession().refresh(T)).toMatchObject({ ok: false, code: 'DEVICE_REVOKED' })
    expect(f).not.toHaveBeenCalled()
  })
})

describe('data-layer: cualquier request normal', () => {
  it.each([
    ['proxy genérico', '/api/products', 'GET'],
    ['polling de MercadoPago', '/api/mercadopago/polling/start', 'POST'],
    ['entitlement', '/api/billing/entitlement', 'GET'],
  ])('403 DEVICE_REVOKED en %s corta la sesión, sin reintento ni renovación, y conserva el secreto', async (_n, path, method) => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(forbidden('DEVICE_REVOKED'))
    const r1 = await handleApiRequest(req(path, bearer(), method))
    expect(r1.status).toBe(403)
    expect(getDeviceState().endedReason(T)).toBe('DEVICE_REVOKED')
    expect(getDeviceState().get(T)).toMatchObject({ secret: 'S1', sessionActive: true })
    // ninguna llamada a /api/auth/device/refresh (no es el 401 recuperable)
    expect(f.mock.calls.every(([u]) => !String(u).includes('/api/auth/device/'))).toBe(true)
    const calls = f.mock.calls.length
    // desde ahora TODA operación con el JWT pos se corta localmente (incluida una venta nueva: no se encola)
    const r2 = await handleApiRequest(req('/api/sales', bearer(), 'POST'))
    expect(r2.status).toBe(403)
    expect(await r2.json()).toMatchObject({ code: 'DEVICE_REVOKED' })
    expect(f.mock.calls.length).toBe(calls)
  })

  it('un 401 NO corta la sesión (sigue siendo recuperable por la renovación obligatoria)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ code: 'DEVICE_REVOKED' }), { status: 401 }))
    await handleApiRequest(req('/api/products'))
    expect(getDeviceState().endedReason(T)).toBeNull()
  })

  it('el login sigue pasando con la sesión terminada y un nuevo login la reactiva', async () => {
    getDeviceSession().reportEnded(T, 'DEVICE_REVOKED')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ success: true, data: { accessToken: 'J', user: { tenantId: T }, deviceSecret: 'S9' } }), { status: 200 }))
    const res = await handleApiRequest(new Request('http://localhost:3000/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'a@x.com', password: 'p' }) }))
    expect(res.status).toBe(200)
    expect(getDeviceState().endedReason(T)).toBeNull()
  })

  it('web (sin caja): un 403 con ese code pasa tal cual y no marca nada', async () => {
    vi.stubEnv('OMERO_DEVICE_ID', '')
    resetDeviceState()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(forbidden('DEVICE_REVOKED'))
    expect((await handleApiRequest(req('/api/products'))).status).toBe(403)
    expect(getDeviceState().endedReason(T)).toBeNull()
  })
})

describe('syncer y outbox: pasan al camino sync-token', () => {
  const freshSyncer = (fetchFn: typeof fetch) => {
    const syncer = new CatalogSyncer({ fetchFn, getStore: () => ({}) as never, backendUrl: () => 'http://127.0.0.1:9', log: vi.fn() })
    syncer.setRenewer(async (t) => (await getDeviceSession().refresh(t)).ok)
    getDeviceSession().setSink(syncer)
    return syncer
  }

  it('el ciclo del syncer que recibe 403 DEVICE_REVOKED termina la sesión (y olvida el JWT pos)', async () => {
    const f = vi.fn(async () => forbidden('DEVICE_REVOKED'))
    const syncer = freshSyncer(f as never)
    syncer.remember(T, bearer())
    await syncer.syncAll()
    expect(getDeviceState().endedReason(T)).toBe('DEVICE_REVOKED')
    expect(syncer.getAuthorization(T)).toBeNull()
    expect(getDeviceState().get(T)?.secret).toBe('S1')
    expect(f).toHaveBeenCalledTimes(1) // sin reintento ni refresh (el refresh se corta localmente)
  })

  it('token-provider: con la sesión terminada ignora el JWT pos vigente y entrega el sync-token (sin refresh)', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ success: true, data: { accessToken: 'SYNC', expiresIn: 3600 } }), { status: 200 }))
    wireDevice()
    const syncer = getSyncer()
    const live = bearer()
    syncer.remember(T, live)
    getDeviceSession().reportEnded(T, 'DEVICE_REVOKED') // olvida el pos
    syncer.remember(T, live) // aunque algo lo vuelva a dejar en memoria
    const a = await new TokenProvider().authorize(T)
    expect(a).toEqual({ ok: true, authorization: 'Bearer SYNC', kind: 'sync' })
    expect(f.mock.calls.map(([u]) => String(u))).toEqual(['http://127.0.0.1:9/api/auth/device/sync-token'])
  })

  it('token-provider: ventana de sync cerrada → unauthorized (no insiste, sin error crudo)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ success: false, error: 'x', code: 'SYNC_WINDOW_CLOSED' }), { status: 403 }))
    wireDevice()
    getDeviceSession().reportEnded(T, 'DEVICE_REVOKED')
    expect(await new TokenProvider().authorize(T)).toEqual({ ok: false, reason: 'unauthorized' })
  })

  it('el primer intento al reconectar no depende del gate de 24 h (lastCheckedAt reciente)', async () => {
    expect(getDeviceState().get(T)?.lastCheckedAt).toBeGreaterThan(Date.now() - 120_000)
    const f = vi.fn(async () => forbidden('DEVICE_REVOKED'))
    const syncer = freshSyncer(f as never)
    syncer.remember(T, bearer())
    await syncer.syncAll()
    expect(f).toHaveBeenCalled() // la request salió igual y detectó el corte
    expect(getDeviceState().endedReason(T)).toBe('DEVICE_REVOKED')
  })
})
