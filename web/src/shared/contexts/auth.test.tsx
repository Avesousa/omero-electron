import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

const wipeLocalCatalogCache = vi.fn()
vi.mock('@/lib/localCache', () => ({ wipeLocalCatalogCache: () => wipeLocalCatalogCache() }))

const clearSession = vi.fn()
vi.mock('@/lib/sessionManager', () => ({
  setSession: vi.fn(),
  clearSession: () => clearSession(),
  getSessionUser: () => ({ id: '1', email: 'cajero@x.com', name: 'Cajero' }),
  authHeaders: () => ({ Authorization: 'Bearer tok' }),
}))
vi.mock('@/shared/services/authService', () => ({ postLogin: vi.fn() }))

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
