// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getLocalSession, logoutLocalSession, refreshLocalSession } from './session-api'
import { getDeviceSession, resetDeviceSession } from './device-session'
import { getDeviceState, resetDeviceState } from './device-state'
import { resetWiring } from './device-wiring'
import { GET as sessionGet, DELETE as sessionDelete } from '../../app/api/%5Flocal/session/route'
import { POST as refreshPost } from '../../app/api/%5Flocal/session/refresh/route'
import { getSyncer } from '../catalog/syncer'

const T = '724c4579-ea83-4cef-9f37-bcfbfcc12268'
const T2 = '11111111-2222-3333-4444-555555555555'
const ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const user = { id: 'u', name: 'Ana', email: 'a@x.com', role: 'omero-admin', tenantId: T, permissions: ['VENTAS_VER'] }
const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200 })
const err = (status: number, code: string) => new Response(JSON.stringify({ success: false, error: code, code }), { status })
const bearer = (tenant: string) => {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
  return `Bearer ${b64({ alg: 'x' })}.${b64({ tenantId: tenant, exp: 1 })}.s` // vencido: solo sirve de pista
}
const req = (method = 'POST', auth?: string) => new Request('http://localhost:3000/api/_local/session/refresh', { method, headers: auth ? { authorization: auth } : {} })

function boot(secrets: Record<string, unknown> = { [T]: { secret: 'S1', sessionActive: true } }) {
  vi.stubEnv('OMERO_DEVICE_SECRETS', JSON.stringify(secrets))
  resetDeviceState()
  resetDeviceSession()
  resetWiring()
}

beforeEach(() => {
  vi.stubEnv('OMERO_RUNTIME', 'desktop')
  vi.stubEnv('BACKEND_URL', 'http://127.0.0.1:9')
  vi.stubEnv('OMERO_DEVICE_ID', ID)
  vi.stubEnv('OMERO_DEVICE_PERSIST', '0')
  boot()
})
afterEach(() => {
  resetDeviceState()
  resetDeviceSession()
  resetWiring()
  getSyncer().setRenewer(null)
  getSyncer().forget(T)
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('POST /api/_local/session/refresh', () => {
  it('renueva: 200 {accessToken,expiresIn,user}, sin secreto, y rota el secreto guardado', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok({ accessToken: 'JWT2', expiresIn: 3600, deviceSecret: 'S2', deviceExpiresAt: 'x', user }))
    const res = await refreshPost(req())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toEqual({ accessToken: 'JWT2', expiresIn: 3600, user })
    expect(JSON.stringify(body)).not.toMatch(/S2|deviceSecret/)
    expect(JSON.parse(String(f.mock.calls[0][1]!.body))).toEqual({ deviceSecret: 'S1' })
    expect(getDeviceState().get(T)?.secret).toBe('S2')
    expect(getSyncer().getAuthorization(T)).toBe('Bearer JWT2') // el JWT renovado quedó en el syncer (sink cableado)
  })

  it.each([
    [401, 'LOGIN_REQUIRED', 401], [401, 'DEVICE_EXPIRED', 401], [403, 'DEVICE_REVOKED', 403], [401, 'DEVICE_SECRET_INVALID', 401],
  ])('backend %i %s → local %i con code', async (s, code, local) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(err(s, code))
    const res = await refreshLocalSession(req())
    expect(res.status).toBe(local)
    expect((await res.json()).code).toBe(code)
  })

  it('sin red → 503 UNAVAILABLE', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'))
    const res = await refreshLocalSession(req())
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('UNAVAILABLE')
  })

  it('el tenant sale de la pista (JWT vencido) o de la última sesión; sin ninguno → 401 NO_DEVICE', async () => {
    boot({ [T]: { secret: 'S1', sessionActive: true }, [T2]: { secret: 'SB', sessionActive: true } })
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok({ accessToken: 'J', expiresIn: 1, deviceSecret: 'N', deviceExpiresAt: '', user }))
    await refreshLocalSession(req('POST', bearer(T2)))
    expect(JSON.parse(String(f.mock.calls[0][1]!.body))).toEqual({ deviceSecret: 'SB' })

    boot({ [T]: { secret: 'S1', sessionActive: true }, [T2]: { secret: 'SB', sessionActive: true } })
    const none = await refreshLocalSession(req())
    expect(none.status).toBe(401)
    expect((await none.json()).code).toBe('NO_DEVICE')
  })

  it('la sesión cerrada por logout no se renueva sin login (LOGIN_REQUIRED, sin llamar al backend)', async () => {
    boot({ [T]: { secret: 'S1', sessionActive: false } })
    const f = vi.spyOn(globalThis, 'fetch')
    const res = await refreshLocalSession(req('POST', bearer(T)))
    expect(res.status).toBe(401)
    expect((await res.json()).code).toBe('LOGIN_REQUIRED')
    expect(f).not.toHaveBeenCalled()
  })

  it('web o sin identidad de caja → 401 NO_DEVICE', async () => {
    vi.stubEnv('OMERO_RUNTIME', 'web')
    expect((await refreshLocalSession(req())).status).toBe(401)
    vi.stubEnv('OMERO_RUNTIME', 'desktop')
    vi.stubEnv('OMERO_DEVICE_ID', '')
    resetDeviceState()
    expect((await refreshLocalSession(req())).status).toBe(401)
    vi.stubEnv('OMERO_RUNTIME', '')
    expect((await refreshLocalSession(req())).status).toBe(401) // entorno inválido → tratado como web
  })
})

describe('GET /api/_local/session', () => {
  it('desktop con caja: hasDevice + sessionActive, sin secreto', async () => {
    const body = await (await sessionGet(req('GET', bearer(T)))).json()
    expect(body.data).toEqual({ desktop: true, hasDevice: true, sessionActive: true })
    expect(JSON.stringify(body)).not.toContain('S1')
  })
  it('sin caja registrada o web → hasDevice=false', async () => {
    boot({})
    expect((await getLocalSession(req('GET'))).status).toBe(200)
    expect((await (await getLocalSession(req('GET'))).json()).data).toEqual({ desktop: true, hasDevice: false, sessionActive: false })
    vi.stubEnv('OMERO_RUNTIME', 'web')
    expect((await (await getLocalSession(req('GET'))).json()).data).toEqual({ desktop: false, hasDevice: false, sessionActive: false })
  })
  it('tras un logout la caja sigue registrada pero sin sesión activa', async () => {
    boot({ [T]: { secret: 'S1', sessionActive: false } })
    expect((await (await getLocalSession(req('GET', bearer(T)))).json()).data).toEqual({ desktop: true, hasDevice: true, sessionActive: false })
  })
})

describe('DELETE /api/_local/session (logout de la caja)', () => {
  it('conserva el secreto, marca la sesión cerrada y avisa al backend', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok(null))
    const res = await sessionDelete(req('DELETE', bearer(T)))
    expect(res.status).toBe(204)
    expect(getDeviceState().get(T)).toEqual({ secret: 'S1', sessionActive: false })
    expect(String(f.mock.calls[0][0])).toBe('http://127.0.0.1:9/api/auth/device/logout')
  })
  it('sin caja / web → 204 sin hacer nada', async () => {
    const f = vi.spyOn(globalThis, 'fetch')
    vi.stubEnv('OMERO_RUNTIME', 'web')
    expect((await logoutLocalSession(req('DELETE'))).status).toBe(204)
    vi.stubEnv('OMERO_RUNTIME', 'desktop')
    boot({})
    expect((await logoutLocalSession(req('DELETE'))).status).toBe(204)
    expect(f).not.toHaveBeenCalled()
  })
  it('el backend caído no impide el logout local', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('down'))
    expect((await logoutLocalSession(req('DELETE', bearer(T)))).status).toBe(204)
    expect(getDeviceState().get(T)?.sessionActive).toBe(false)
  })
})

it('getDeviceSession usa el mismo estado que los endpoints', () => {
  expect(getDeviceSession().state).toBe(getDeviceState())
})
