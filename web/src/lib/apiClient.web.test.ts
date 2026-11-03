import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from './apiClient'
import * as device from './deviceSession'
import * as session from './sessionManager'

const resp = (status: number, body?: unknown) => ({
  status,
  ok: status >= 200 && status < 300,
  text: vi.fn().mockResolvedValue(body === undefined ? '' : JSON.stringify(body)),
})
const user = { id: '1', name: 'Ana', email: 'a@x.com', role: 'omero-admin', tenantId: 't', permissions: [] }
const jwt = (exp: number) => `h.${btoa(JSON.stringify({ sub: '1', exp: Math.floor(Date.now() / 1000) + exp }))}.s`

let fetchMock: ReturnType<typeof vi.fn>
const original = window.location

beforeEach(() => {
  session.clearSession()
  localStorage.clear()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  Object.defineProperty(window, 'location', { value: { href: '', pathname: '/pos' }, writable: true, configurable: true })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  session.clearSession()
  Object.defineProperty(window, 'location', { value: original, writable: true, configurable: true })
})

describe('apiFetch: modo web (refresh token) — 401 → renovar → reintentar una vez', () => {
  it('renueva con el refresh token y reintenta con el JWT nuevo', async () => {
    session.setSession(jwt(3600), user, 'rt-1')
    const nuevo = jwt(7200)
    vi.spyOn(session, 'refreshSession').mockImplementation(async () => {
      sessionStorage.setItem('omero_auth_token', nuevo)
      return { ok: true }
    })
    fetchMock.mockResolvedValueOnce(resp(401)).mockResolvedValueOnce(resp(200, { success: true, data: 1 }))
    const renewDevice = vi.spyOn(device, 'renewSession')
    expect(await apiFetch('/api/products')).toEqual({ success: true, data: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect((fetchMock.mock.calls[1][1].headers as Record<string, string>).Authorization).toBe(`Bearer ${nuevo}`)
    expect(renewDevice).not.toHaveBeenCalled() // NO se usa el flujo de la caja
  })

  it('SESSION_REPLACED en el refresh → /login?reason=replaced', async () => {
    session.setSession(jwt(3600), user, 'rt-1')
    vi.spyOn(session, 'refreshSession').mockResolvedValue({ ok: false, reason: 'replaced' })
    fetchMock.mockResolvedValue(resp(401, { code: 'SESSION_REPLACED' }))
    const r = await apiFetch('/api/products')
    expect(r.success).toBe(false)
    expect(window.location.href).toBe('/login?reason=replaced')
    expect(localStorage.getItem('omero_refresh_token')).toBeNull()
  })

  it('fallo definitivo (TOKEN_INVALID) → /login?reason=expired', async () => {
    session.setSession(jwt(3600), user, 'rt-1')
    vi.spyOn(session, 'refreshSession').mockResolvedValue({ ok: false, reason: 'invalid' })
    fetchMock.mockResolvedValue(resp(401))
    await apiFetch('/api/products')
    expect(window.location.href).toBe('/login?reason=expired')
  })

  it('sin red en el refresh NO cierra la sesión', async () => {
    session.setSession(jwt(3600), user, 'rt-1')
    vi.spyOn(session, 'refreshSession').mockResolvedValue({ ok: false, reason: 'network' })
    fetchMock.mockResolvedValue(resp(401))
    const r = await apiFetch('/api/products')
    expect(r).toMatchObject({ success: false, error: expect.stringMatching(/No se pudo conectar/) })
    expect(window.location.href).toBe('')
    expect(localStorage.getItem('omero_refresh_token')).toBe('rt-1')
  })

  it('si tras renovar sigue el 401 → expired, sin más reintentos', async () => {
    session.setSession(jwt(3600), user, 'rt-1')
    vi.spyOn(session, 'refreshSession').mockResolvedValue({ ok: true })
    fetchMock.mockResolvedValue(resp(401))
    await apiFetch('/api/products')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(window.location.href).toBe('/login?reason=expired')
  })

  it('un 401 de /api/auth/* (credenciales) no renueva nada', async () => {
    session.setSession(jwt(3600), user, 'rt-1')
    const refresh = vi.spyOn(session, 'refreshSession')
    fetchMock.mockResolvedValue(resp(401, { success: false, error: 'Credenciales incorrectas' }))
    expect(await apiFetch('/api/auth/login', { method: 'POST' })).toMatchObject({ success: false, error: 'Credenciales incorrectas' })
    expect(refresh).not.toHaveBeenCalled()
  })

  it('devuelve el 409 SESSION_ACTIVE con code y data.lastSeenAt para que el login muestre el aviso', async () => {
    fetchMock.mockResolvedValue(resp(409, { success: false, error: 'Ya hay una sesión', code: 'SESSION_ACTIVE', data: { lastSeenAt: '2026-11-02T10:00:00Z' } }))
    expect(await apiFetch('/api/auth/login', { method: 'POST' })).toMatchObject({ success: false, code: 'SESSION_ACTIVE', data: { lastSeenAt: '2026-11-02T10:00:00Z' } })
  })
})

describe('apiFetch: coexistencia — con caja registrada NO se usa el refresh web', () => {
  it('401 en una caja (sin refresh token): renovación de la caja y reintento; refreshSession jamás se llama', async () => {
    session.setSession(jwt(3600), user, null)
    const refresh = vi.spyOn(session, 'refreshSession')
    const renew = vi.spyOn(device, 'renewSession').mockResolvedValue({ ok: true, user: {} as never })
    fetchMock.mockResolvedValueOnce(resp(401)).mockResolvedValueOnce(resp(200, { success: true, data: 2 }))
    expect(await apiFetch('/api/products')).toEqual({ success: true, data: 2 })
    expect(renew).toHaveBeenCalledTimes(1)
    expect(refresh).not.toHaveBeenCalled()
    expect(fetchMock.mock.calls.every(c => !String(c[0]).includes('/api/auth/refresh'))).toBe(true)
  })

  it('caja con revocación (403 DEVICE_REVOKED): login con motivo de caja, sin refresh web', async () => {
    session.setSession(jwt(3600), user, null)
    const refresh = vi.spyOn(session, 'refreshSession')
    fetchMock.mockResolvedValue(resp(403, { success: false, error: 'x', code: 'DEVICE_REVOKED' }))
    await apiFetch('/api/sales', { method: 'POST' })
    expect(window.location.href).toBe('/login?reason=device-revoked')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('sin caja y sin refresh token (NO_DEVICE): limpia y va a /login como siempre', async () => {
    vi.spyOn(device, 'renewSession').mockResolvedValue({ ok: false, code: 'NO_DEVICE', message: '' })
    const refresh = vi.spyOn(session, 'refreshSession')
    fetchMock.mockResolvedValue(resp(401))
    await apiFetch('/api/products')
    expect(window.location.href).toBe('/login')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('un refreshToken devuelto por un login de caja se descarta aunque exista uno previo', () => {
    localStorage.setItem('omero_refresh_token', 'previo')
    session.setSession(jwt(3600), user, null)
    expect(session.hasRefreshToken()).toBe(false)
  })
})
