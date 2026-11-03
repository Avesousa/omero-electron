// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDeviceState, resetDeviceState } from './device-state'
import { handleLogin, isLoginRoute } from './session-proxy'
import { handleApiRequest } from '../data-layer'

const T = '724c4579-ea83-4cef-9f37-bcfbfcc12268'
const ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

const login = (body: unknown, extraHeaders: Record<string, string> = {}) =>
  new Request('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...extraHeaders },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
const backendOk = (data: Record<string, unknown>) =>
  new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  vi.stubEnv('OMERO_RUNTIME', 'desktop')
  vi.stubEnv('BACKEND_URL', 'http://127.0.0.1:9')
  vi.stubEnv('OMERO_DEVICE_ID', ID)
  vi.stubEnv('OMERO_DEVICE_NAME', 'MOSTRADOR')
  vi.stubEnv('OMERO_DEVICE_PLATFORM', 'win32')
  vi.stubEnv('OMERO_APP_VERSION', '1.2.3')
  vi.stubEnv('OMERO_DEVICE_PERSIST', '0')
  resetDeviceState()
})
afterEach(() => {
  resetDeviceState()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('isLoginRoute', () => {
  it.each([['POST', '/api/auth/login', true], ['POST', '/api/auth/login-key', true], ['GET', '/api/auth/login-key', false], ['POST', '/api/auth/login-keys', false], ['post', '/api/auth/login/', true], ['GET', '/api/auth/login', false], ['POST', '/api/auth/register', false], ['POST', '/api/auth/device/refresh', false]])(
    '%s %s → %s', (m, p, e) => expect(isLoginRoute(m, p)).toBe(e))
})

describe('handleLogin', () => {
  it('agrega el bloque device, guarda el secreto y lo QUITA de la respuesta (el renderer nunca lo ve)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      backendOk({ accessToken: 'JWT', refreshToken: 'R', user: { tenantId: T, email: 'a@x.com' }, deviceSecret: 'SECRETO-DE-CAJA' }),
    )
    const res = await handleLogin(login({ email: 'a@x.com', password: 'pw' }))

    const sent = JSON.parse(await new Response(fetchSpy.mock.calls[0][1]!.body as never).text())
    expect(sent).toEqual({ email: 'a@x.com', password: 'pw', device: { deviceId: ID, name: 'MOSTRADOR', platform: 'win32', appVersion: '1.2.3' } })
    expect(String(fetchSpy.mock.calls[0][0])).toBe('http://127.0.0.1:9/api/auth/login')

    const body = await res.json()
    expect(body.data.accessToken).toBe('JWT')
    expect(JSON.stringify(body)).not.toContain('SECRETO-DE-CAJA')
    expect(body.data).not.toHaveProperty('deviceSecret')
    expect(getDeviceState().get(T)).toEqual({ secret: 'SECRETO-DE-CAJA', sessionActive: true, lastCheckedAt: expect.any(Number) })
  })

  it('el login con clave numérica también registra la caja y oculta el secreto', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      backendOk({ accessToken: 'JWT', user: { tenantId: T }, deviceSecret: 'SECRETO-CLAVE' }),
    )
    const req = new Request('http://localhost:3000/api/auth/login-key', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantId: T, key: '12345678' }),
    })
    const res = await handleLogin(req)

    const sent = JSON.parse(await new Response(fetchSpy.mock.calls[0][1]!.body as never).text())
    expect(sent).toEqual({ tenantId: T, key: '12345678', device: { deviceId: ID, name: 'MOSTRADOR', platform: 'win32', appVersion: '1.2.3' } })
    expect(String(fetchSpy.mock.calls[0][0])).toBe('http://127.0.0.1:9/api/auth/login-key')
    expect(JSON.stringify(await res.json())).not.toContain('SECRETO-CLAVE')
    expect(getDeviceState().get(T)).toEqual({ secret: 'SECRETO-CLAVE', sessionActive: true, lastCheckedAt: expect.any(Number) })
  })

  it('un backend viejo (sin deviceSecret) pasa igual y no se registra nada', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(backendOk({ accessToken: 'JWT', user: { tenantId: T } }))
    const res = await handleLogin(login({ email: 'a@x.com', password: 'pw' }))
    expect((await res.json()).data.accessToken).toBe('JWT')
    expect(getDeviceState().hasSecrets).toBe(false)
  })

  it('errores del backend pasan tal cual (contraseña mala, caja revocada con su code)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: 'Esta caja fue revocada', code: 'DEVICE_REVOKED' }), { status: 403, headers: { 'content-type': 'application/json' } }),
    )
    const res = await handleLogin(login({ email: 'a@x.com', password: 'pw' }))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('DEVICE_REVOKED')
    expect(getDeviceState().hasSecrets).toBe(false)
  })

  it('una respuesta 200 que no es JSON se devuelve tal cual', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>', { status: 200 }))
    const res = await handleLogin(login({ email: 'a@x.com', password: 'pw' }))
    expect(await res.text()).toBe('<html>')
  })

  it('sin identidad de caja (web / dev sin Electron) → proxy directo, cuerpo intacto', async () => {
    vi.stubEnv('OMERO_DEVICE_ID', '')
    resetDeviceState()
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(backendOk({ accessToken: 'JWT', user: { tenantId: T } }))
    await handleLogin(login({ email: 'a@x.com', password: 'pw' }))
    const sent = JSON.parse(await new Response(fetchSpy.mock.calls[0][1]!.body as never).text())
    expect(sent).toEqual({ email: 'a@x.com', password: 'pw' })
  })

  it.each([['cuerpo que no es JSON', '{no'], ['JSON que no es objeto', '[1,2]']])('%s → proxy directo sin tocarlo', async (_n, raw) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"success":false,"error":"x"}', { status: 400 }))
    await handleLogin(login(raw))
    const sent = await new Response(fetchSpy.mock.calls[0][1]!.body as never).text()
    expect(sent).toBe(raw)
  })

  it('a través de handleApiRequest: desktop intercepta; web NO', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => backendOk({ accessToken: 'JWT', user: { tenantId: T }, deviceSecret: 'S' }))
    const res = await handleApiRequest(login({ email: 'a@x.com', password: 'pw' }))
    expect(JSON.stringify(await res.json())).not.toContain('"deviceSecret"')

    vi.stubEnv('OMERO_RUNTIME', 'web')
    fetchSpy.mockClear()
    await handleApiRequest(login({ email: 'a@x.com', password: 'pw' }))
    const sent = JSON.parse(await new Response(fetchSpy.mock.calls[0][1]!.body as never).text())
    expect(sent).not.toHaveProperty('device')
  })
})

describe('login que responde 409 SESSION_ACTIVE (login web sin `device`)', () => {
  const conflict = () => new Response(JSON.stringify({ success: false, error: 'Ya hay una sesión activa', code: 'SESSION_ACTIVE' }), { status: 409, headers: { 'content-type': 'application/json' } })

  it('con caja: el 409 pasa tal cual (no se guarda secreto ni se rompe)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(conflict())
    const res = await handleLogin(login({ email: 'a@x.com', password: 'pw' }))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('SESSION_ACTIVE')
    expect(getDeviceState().hasSecrets).toBe(false)
  })

  it('sin caja (web / sin Electron): proxy directo, el 409 llega intacto al cliente', async () => {
    vi.stubEnv('OMERO_DEVICE_ID', '')
    resetDeviceState()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(conflict())
    const res = await handleLogin(login({ email: 'a@x.com', password: 'pw' }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/sesión activa/)
  })
})


describe('validateDeviceOnRequest (validación pasiva al operar)', () => {
  const mkReq = (auth?: string) => new Request('http://localhost:3000/api/products', { headers: auth ? { authorization: auth } : {} })
  const bearer = () => {
    const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
    return `Bearer ${b64({ alg: 'x' })}.${b64({ tenantId: T, exp: 1 })}.s`
  }

  it('con caja: pide al DeviceSession validar al tenant del JWT (aunque esté vencido)', async () => {
    const { validateDeviceOnRequest } = await import('./session-proxy')
    const { getDeviceSession, resetDeviceSession } = await import('./device-session')
    resetDeviceSession()
    const spy = vi.spyOn(getDeviceSession(), 'validateIfDue').mockResolvedValue()
    validateDeviceOnRequest(mkReq(bearer()))
    expect(spy).toHaveBeenCalledWith(T)
    resetDeviceSession()
  })

  it('sin caja (web) o sin tenant: no hace nada y nunca lanza', async () => {
    const { validateDeviceOnRequest } = await import('./session-proxy')
    const { getDeviceSession, resetDeviceSession } = await import('./device-session')
    resetDeviceSession()
    const spy = vi.spyOn(getDeviceSession(), 'validateIfDue').mockResolvedValue()
    validateDeviceOnRequest(mkReq()) // caja habilitada pero sin secretos ni tenant
    vi.stubEnv('OMERO_DEVICE_ID', '')
    resetDeviceState()
    validateDeviceOnRequest(mkReq(bearer()))
    expect(spy).not.toHaveBeenCalled()
    resetDeviceSession()
  })
})
