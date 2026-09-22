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
  it.each([['POST', '/api/auth/login', true], ['post', '/api/auth/login/', true], ['GET', '/api/auth/login', false], ['POST', '/api/auth/register', false], ['POST', '/api/auth/device/refresh', false]])(
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
    expect(getDeviceState().get(T)).toEqual({ secret: 'SECRETO-DE-CAJA', sessionActive: true })
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
