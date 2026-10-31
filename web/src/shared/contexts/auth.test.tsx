import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

const wipeLocalCatalogCache = vi.fn()
const pendingOutboxCount = vi.fn(async () => 0)
const deviceLogout = vi.fn()
vi.mock('@/lib/deviceSession', () => ({ deviceLogout: () => deviceLogout(), fetchDeviceInfo: async () => ({ desktop: false, hasDevice: false, sessionActive: false }), renewSession: vi.fn(), reasonFor: () => null }))
vi.mock('@/lib/localCache', () => ({
  wipeLocalCatalogCache: () => wipeLocalCatalogCache(),
  pendingOutboxCount: () => pendingOutboxCount(),
  logoutWarning: (n: number) => `aviso ${n}`,
}))

const clearSession = vi.fn()
const getSessionUserMock = vi.fn<() => unknown>(() => ({ id: '1', email: 'cajero@x.com', name: 'Cajero' }))
vi.mock('@/lib/sessionManager', () => ({
  setSession: vi.fn(),
  clearSession: () => clearSession(),
  getSessionUser: () => getSessionUserMock(),
  authHeaders: () => ({ Authorization: 'Bearer tok' }),
}))
const postLogin = vi.fn()
const postLoginKey = vi.fn()
vi.mock('@/shared/services/authService', () => ({ postLogin: (...a: unknown[]) => postLogin(...a), postLoginKey: (...a: unknown[]) => postLoginKey(...a) }))
const saveLoginHint = vi.fn(async () => {})
vi.mock('@/lib/loginHint', () => ({ saveLoginHint: (h: unknown) => saveLoginHint(h) }))

import { AuthProvider, useAuth } from './auth'

function LogoutButton() {
  const { logout, isAuthenticated } = useAuth()
  return (
    <button onClick={logout}>
      {isAuthenticated ? 'salir' : 'anónimo'}
    </button>
  )
}

beforeEach(() => {
  push.mockClear()
  clearSession.mockClear()
  wipeLocalCatalogCache.mockClear()
  deviceLogout.mockClear()
  pendingOutboxCount.mockReset()
  pendingOutboxCount.mockResolvedValue(0)
})
afterEach(() => vi.restoreAllMocks())

describe('AuthProvider.logout', () => {
  it('borra la caché local ANTES de limpiar la sesión y redirige al login', async () => {
    render(<AuthProvider><LogoutButton /></AuthProvider>)
    await act(async () => {})
    await act(async () => { screen.getByRole('button', { name: 'salir' }).click() })

    expect(wipeLocalCatalogCache).toHaveBeenCalledTimes(1)
    expect(clearSession).toHaveBeenCalled()
    // el DELETE necesita el token: tiene que ir antes de clearSession
    expect(wipeLocalCatalogCache.mock.invocationCallOrder[0]).toBeLessThan(clearSession.mock.invocationCallOrder.at(-1)!)
    expect(push).toHaveBeenCalledWith('/login')
    expect(screen.getByRole('button', { name: 'anónimo' })).toBeInTheDocument()
  })
})

describe('AuthProvider.logout con ventas/gastos sin subir (outbox)', () => {
  const click = async () => {
    render(<AuthProvider><LogoutButton /></AuthProvider>)
    await act(async () => {})
    await act(async () => { screen.getByRole('button', { name: 'salir' }).click() })
  }

  it('avisa y, si el cajero confirma, cierra sesión (el outbox no se borra: solo se limpia la caché de catálogo)', async () => {
    pendingOutboxCount.mockResolvedValue(3)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await click()
    expect(confirm).toHaveBeenCalledWith('aviso 3')
    expect(wipeLocalCatalogCache).toHaveBeenCalledTimes(1)
    expect(deviceLogout).toHaveBeenCalledTimes(1) // la caja cierra sesión (conserva el secreto para subir lo pendiente)
    expect(clearSession).toHaveBeenCalled()
    expect(push).toHaveBeenCalledWith('/login')
  })

  it('si el cajero cancela, NO cierra sesión ni borra nada', async () => {
    pendingOutboxCount.mockResolvedValue(2)
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    await click()
    expect(wipeLocalCatalogCache).not.toHaveBeenCalled()
    expect(deviceLogout).not.toHaveBeenCalled()
    expect(clearSession).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'salir' })).toBeInTheDocument()
  })

  it('sin pendientes no pregunta nada', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    await click()
    expect(confirm).not.toHaveBeenCalled()
    expect(push).toHaveBeenCalledWith('/login')
  })
})

describe('expiración de sesión (401) NO borra la caché', () => {
  it('apiFetch con 401 limpia la sesión pero no llama a wipeLocalCatalogCache', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })))
    // apiFetch hace `window.location.href = '/login'`: jsdom no implementa navegación, se reemplaza `location`
    const originalLocation = window.location
    Object.defineProperty(window, 'location', { value: { href: '' }, writable: true, configurable: true })
    const { apiFetch } = await import('@/lib/apiClient')
    const result = await apiFetch('/api/products')
    expect(result.success).toBe(false)
    expect(clearSession).toHaveBeenCalled()
    expect(wipeLocalCatalogCache).not.toHaveBeenCalled()
    Object.defineProperty(window, 'location', { value: originalLocation, writable: true, configurable: true })
    vi.unstubAllGlobals()
  })
})

const TENANT = '724c4579-ea83-4cef-9f37-bcfbfcc12268'
const loginOk = (extra: Record<string, unknown> = {}) => ({
  success: true as const,
  data: { accessToken: 'jwt', refreshToken: 'r', expiresIn: '3600', user: { id: '1', tenantId: TENANT }, ...extra },
})

function LoginButtons() {
  const { login, error } = useAuth()
  return (
    <>
      <button onClick={() => void login({ email: 'a@x.com', password: 'secreto123' })}>email</button>
      <button onClick={() => void login({ tenantId: TENANT, key: '12345678' })}>clave</button>
      <span data-testid="err">{error}</span>
    </>
  )
}

describe('AuthProvider.login (email y clave numérica)', () => {
  beforeEach(() => {
    postLogin.mockReset()
    postLoginKey.mockReset()
    saveLoginHint.mockClear()
  })

  it('con email usa /login y guarda la pista (tenant + si el negocio ofrece clave)', async () => {
    postLogin.mockResolvedValue(loginOk({ quickKeyLoginEnabled: true }))
    render(<AuthProvider><LoginButtons /></AuthProvider>)
    await act(async () => {})
    await act(async () => { screen.getByRole('button', { name: 'email' }).click() })
    expect(postLogin).toHaveBeenCalledWith({ email: 'a@x.com', password: 'secreto123' })
    expect(postLoginKey).not.toHaveBeenCalled()
    expect(saveLoginHint).toHaveBeenCalledWith({ tenantId: TENANT, quickKeyLoginEnabled: true })
    expect(push).toHaveBeenCalledWith('/')
  })

  it('un backend viejo (sin el campo) guarda la pista con la clave apagada', async () => {
    postLogin.mockResolvedValue(loginOk())
    render(<AuthProvider><LoginButtons /></AuthProvider>)
    await act(async () => {})
    await act(async () => { screen.getByRole('button', { name: 'email' }).click() })
    expect(saveLoginHint).toHaveBeenCalledWith({ tenantId: TENANT, quickKeyLoginEnabled: false })
  })

  it('con clave usa /login-key con tenantId + clave (sin email ni contraseña)', async () => {
    postLoginKey.mockResolvedValue(loginOk({ quickKeyLoginEnabled: true }))
    render(<AuthProvider><LoginButtons /></AuthProvider>)
    await act(async () => {})
    await act(async () => { screen.getByRole('button', { name: 'clave' }).click() })
    expect(postLoginKey).toHaveBeenCalledWith({ tenantId: TENANT, key: '12345678' })
    expect(postLogin).not.toHaveBeenCalled()
    expect(push).toHaveBeenCalledWith('/')
  })

  it('una clave incorrecta muestra el error del backend (en español) y no guarda nada', async () => {
    postLoginKey.mockResolvedValue({ success: false, error: 'Clave incorrecta' })
    render(<AuthProvider><LoginButtons /></AuthProvider>)
    await act(async () => {})
    await act(async () => { screen.getByRole('button', { name: 'clave' }).click() })
    expect(screen.getByTestId('err')).toHaveTextContent('Clave incorrecta')
    expect(saveLoginHint).not.toHaveBeenCalled()
  })
})

describe('AuthProvider.syncSession (regresión relanzamiento en blanco)', () => {
  function Probe() {
    const { isAuthenticated, syncSession } = useAuth()
    return <button onClick={() => syncSession()}>{isAuthenticated ? 'con sesión' : 'sin sesión'}</button>
  }

  afterEach(() => getSessionUserMock.mockImplementation(() => ({ id: '1', email: 'cajero@x.com', name: 'Cajero' })))

  it('relee la sesión que se renovó fuera del provider y pasa a autenticado', async () => {
    getSessionUserMock.mockReturnValue(null)
    render(<AuthProvider><Probe /></AuthProvider>)
    await act(async () => {})
    expect(screen.getByRole('button')).toHaveTextContent('sin sesión')
    getSessionUserMock.mockReturnValue({ id: '2', email: 'a@b.com', name: 'X' }) // la renovó LoginForm
    await act(async () => { screen.getByRole('button').click() })
    expect(screen.getByRole('button')).toHaveTextContent('con sesión')
  })

  it('sin sesión sigue sin sesión; y un storage que lanza no rompe', async () => {
    getSessionUserMock.mockReturnValue(null)
    render(<AuthProvider><Probe /></AuthProvider>)
    await act(async () => {})
    await act(async () => { screen.getByRole('button').click() })
    expect(screen.getByRole('button')).toHaveTextContent('sin sesión')
    getSessionUserMock.mockImplementation(() => { throw new Error('storage') })
    await act(async () => { screen.getByRole('button').click() })
    expect(screen.getByRole('button')).toHaveTextContent('sin sesión')
  })
})
