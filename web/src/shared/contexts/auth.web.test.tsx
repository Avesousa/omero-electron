import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

const deviceInfo = vi.fn(async () => ({ desktop: false, hasDevice: false, sessionActive: false }) as Record<string, unknown>)
const deviceLogout = vi.fn()
const syncDeviceSessionCookie = vi.fn(async () => {})
vi.mock('@/lib/deviceSession', () => ({
  deviceLogout: () => deviceLogout(),
  fetchDeviceInfo: () => deviceInfo(),
  syncDeviceSessionCookie: () => syncDeviceSessionCookie(),
  renewSession: vi.fn(async () => ({ ok: false, code: 'NO_DEVICE', message: '' })),
  reasonFor: () => null,
}))
vi.mock('@/lib/localCache', () => ({
  wipeLocalCatalogCache: vi.fn(),
  pendingOutboxCount: async () => 0,
  logoutWarning: () => '',
}))
vi.mock('@/lib/loginHint', () => ({ saveLoginHint: vi.fn(async () => {}) }))
vi.mock('@/lib/useSessionRenewal', () => ({ useSessionRenewal: vi.fn() }))

const postLogin = vi.fn()
const postLoginKey = vi.fn()
const postLogout = vi.fn(async () => {})
vi.mock('@/shared/services/authService', () => ({
  postLogin: (...a: unknown[]) => postLogin(...a),
  postLoginKey: (...a: unknown[]) => postLoginKey(...a),
  postLogout: (...a: unknown[]) => postLogout(...a),
  SESSION_ACTIVE: 'SESSION_ACTIVE',
}))

import * as session from '@/lib/sessionManager'
import { AuthProvider, useAuth } from './auth'

const user = { id: '1', name: 'Ana', email: 'a@x.com', role: 'omero-admin', tenantId: 't', permissions: [] }
const jwt = (exp = 3600) => `h.${btoa(JSON.stringify({ sub: '1', exp: Math.floor(Date.now() / 1000) + exp }))}.s`
const loginOk = (refreshToken = 'rt-1') => ({ success: true as const, data: { accessToken: jwt(), refreshToken, expiresIn: '3600', user } })
const conflict = { success: false as const, error: 'Ya hay una sesión', code: 'SESSION_ACTIVE', data: { lastSeenAt: '2026-11-02T10:00:00Z' } }
const cookie = (name: string) => document.cookie.split('; ').find(c => c.startsWith(`${name}=`))?.slice(name.length + 1) ?? null

let api: ReturnType<typeof useAuth>
function Probe() {
  api = useAuth()
  return <div>{api.sessionConflict ? `conflicto:${api.sessionConflict.lastSeenAt}` : 'sin conflicto'}</div>
}
const mount = async () => { await act(async () => { render(<AuthProvider><Probe /></AuthProvider>) }) }
const creds = { email: 'a@x.com', password: 'pw' }

beforeEach(() => {
  session.clearSession()
  localStorage.clear()
  push.mockReset(); postLogin.mockReset(); postLoginKey.mockReset(); postLogout.mockClear(); deviceLogout.mockClear(); syncDeviceSessionCookie.mockClear()
  deviceInfo.mockImplementation(async () => ({ desktop: false, hasDevice: false, sessionActive: false }))
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })))
})
afterEach(() => {
  session.stopSessionRenewal()
  session.clearSession()
  vi.unstubAllGlobals()
})

describe('AuthProvider — modo web (sin caja)', () => {
  it('login: guarda el refresh token y la cookie-señal, y arranca la renovación', async () => {
    postLogin.mockResolvedValue(loginOk('rt-web'))
    await mount()
    await act(async () => { await api.login(creds) })
    expect(localStorage.getItem('omero_refresh_token')).toBe('rt-web')
    expect(cookie('omero_has_refresh')).toBe('1')
    expect(syncDeviceSessionCookie).not.toHaveBeenCalled()
    expect(push).toHaveBeenCalledWith('/')
  })

  it('409 SESSION_ACTIVE: muestra el conflicto (con lastSeenAt) y NO inicia sesión', async () => {
    postLogin.mockResolvedValue(conflict)
    await mount()
    await act(async () => { await api.login(creds) })
    expect(screen.getByText('conflicto:2026-11-02T10:00:00Z')).toBeInTheDocument()
    expect(api.isAuthenticated).toBe(false)
    expect(localStorage.getItem('omero_refresh_token')).toBeNull()
  })

  it('409 con lastSeenAt en la raíz también se acepta', async () => {
    postLogin.mockResolvedValue({ success: false, error: 'x', code: 'SESSION_ACTIVE', lastSeenAt: 'RAIZ' })
    await mount()
    await act(async () => { await api.login(creds) })
    expect(screen.getByText('conflicto:RAIZ')).toBeInTheDocument()
  })

  it('confirmReplaceSession reintenta con replaceSession:true y entra', async () => {
    postLogin.mockResolvedValueOnce(conflict).mockResolvedValueOnce(loginOk('rt-2'))
    await mount()
    await act(async () => { await api.login(creds) })
    await act(async () => { await api.confirmReplaceSession() })
    expect(postLogin).toHaveBeenLastCalledWith({ email: 'a@x.com', password: 'pw', replaceSession: true })
    expect(api.sessionConflict).toBeNull()
    expect(localStorage.getItem('omero_refresh_token')).toBe('rt-2')
  })

  it('dismissSessionConflict cancela y confirmReplaceSession sin conflicto no hace nada', async () => {
    postLogin.mockResolvedValue(conflict)
    await mount()
    await act(async () => { await api.login(creds) })
    act(() => api.dismissSessionConflict())
    expect(api.sessionConflict).toBeNull()
    await act(async () => { await api.confirmReplaceSession() })
    expect(postLogin).toHaveBeenCalledTimes(1)
  })

  it('un error común de login se muestra como error, sin conflicto', async () => {
    postLogin.mockResolvedValue({ success: false, error: 'Credenciales incorrectas' })
    await mount()
    await act(async () => { await api.login(creds) })
    expect(api.error).toBe('Credenciales incorrectas')
    expect(api.sessionConflict).toBeNull()
  })

  it('logout: revoca la sesión en el backend con el refresh token y limpia todo', async () => {
    postLogin.mockResolvedValue(loginOk('rt-web'))
    await mount()
    await act(async () => { await api.login(creds) })
    await act(async () => { api.logout(); await Promise.resolve() })
    expect(postLogout).toHaveBeenCalledWith('rt-web')
    expect(localStorage.getItem('omero_refresh_token')).toBeNull()
    expect(cookie('omero_has_refresh')).toBeNull()
    expect(push).toHaveBeenLastCalledWith('/login')
  })

  it('al montar con JWT vencido pero refresh token: sigue autenticado y renueva en silencio', async () => {
    session.setSession(jwt(-30), user, 'rt-web')
    const refresh = vi.spyOn(session, 'refreshSession').mockResolvedValue({ ok: true })
    await mount()
    expect(api.isAuthenticated).toBe(true)
    expect(refresh).toHaveBeenCalled()
    refresh.mockRestore()
  })

  it('al montar con la cookie-señal pero sin sesión recuperable: redirige a /login?reason=expired', async () => {
    document.cookie = 'omero_has_refresh=1; Path=/'
    Object.defineProperty(window, 'location', { value: { href: '', pathname: '/pos' }, writable: true, configurable: true })
    await mount()
    expect(window.location.href).toBe('/login?reason=expired')
  })
})

describe('AuthProvider — coexistencia: con caja registrada', () => {
  const asDevice = () => deviceInfo.mockImplementation(async () => ({ desktop: true, hasDevice: true, sessionActive: true }))

  it('login de caja: el refreshToken que venga NO se usa (ni localStorage ni cookie-señal) y se sincroniza la cookie de la caja', async () => {
    asDevice()
    postLogin.mockResolvedValue(loginOk('rt-que-no-se-usa'))
    await mount()
    await act(async () => { await api.login(creds) })
    expect(localStorage.getItem('omero_refresh_token')).toBeNull()
    expect(cookie('omero_has_refresh')).toBeNull()
    expect(syncDeviceSessionCookie).toHaveBeenCalled()
    expect(session.hasRefreshToken()).toBe(false)
  })

  it('un refresh token previo (sesión web anterior) se descarta al entrar como caja', async () => {
    localStorage.setItem('omero_refresh_token', 'viejo')
    asDevice()
    postLogin.mockResolvedValue(loginOk())
    await mount()
    await act(async () => { await api.login(creds) })
    expect(localStorage.getItem('omero_refresh_token')).toBeNull()
  })

  it('un 409 inesperado en una caja NO muestra el modal: es un error normal', async () => {
    asDevice()
    postLogin.mockResolvedValue(conflict)
    await mount()
    await act(async () => { await api.login(creds) })
    expect(api.sessionConflict).toBeNull()
    expect(api.error).toBe('Ya hay una sesión')
  })

  it('login por clave de caja: tampoco usa el refresh web', async () => {
    asDevice()
    postLoginKey.mockResolvedValue(loginOk())
    await mount()
    await act(async () => { await api.login({ tenantId: 't', key: '1234' }) })
    expect(localStorage.getItem('omero_refresh_token')).toBeNull()
  })

  it('logout de caja: deviceLogout y NO llama al logout web del backend', async () => {
    asDevice()
    postLogin.mockResolvedValue(loginOk())
    await mount()
    await act(async () => { await api.login(creds) })
    await act(async () => { api.logout(); await Promise.resolve() })
    expect(deviceLogout).toHaveBeenCalled()
    expect(postLogout).not.toHaveBeenCalled()
  })

  it('al montar en una caja con JWT vigente no arranca la renovación web ni llama al refresh', async () => {
    session.setSession(jwt(3600), user, null)
    const refresh = vi.spyOn(session, 'refreshSession')
    const start = vi.spyOn(session, 'startSessionRenewal')
    await mount()
    expect(api.isAuthenticated).toBe(true)
    expect(start).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
    start.mockRestore(); refresh.mockRestore()
  })
})
