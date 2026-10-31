import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const replace = vi.fn()
const syncSession = vi.fn(() => false)
let auth = { isAuthenticated: false, isLoading: true, syncSession }
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }))
vi.mock('@/shared', () => ({ useAuth: () => auth }))
vi.mock('./LoadingScreen.module.css', () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }))

import { ProtectedRoute } from './ProtectedRoute'
import { clearSession } from '@/lib/sessionManager'

const jwt = (exp: number) => `x.${btoa(JSON.stringify({ exp, sub: 'u' }))}.y`

beforeEach(() => {
  replace.mockClear()
  syncSession.mockReset().mockReturnValue(false)
  clearSession()
})

describe('<ProtectedRoute />', () => {
  it('mientras restaura la sesión muestra un spinner (no pantalla vacía)', () => {
    auth = { isAuthenticated: false, isLoading: true, syncSession }
    render(<ProtectedRoute><p>POS</p></ProtectedRoute>)
    expect(screen.getByRole('status')).toHaveTextContent('Verificando sesión…')
    expect(replace).not.toHaveBeenCalled()
  })

  it('autenticado: muestra el contenido', () => {
    auth = { isAuthenticated: true, isLoading: false, syncSession }
    render(<ProtectedRoute><p>POS</p></ProtectedRoute>)
    expect(screen.getByText('POS')).toBeInTheDocument()
  })

  it('sin sesión: spinner + va al login y limpia la cookie huérfana (evita el bucle /login ↔ /pos en blanco)', () => {
    // Cookie de sesión "válida" para el middleware pero sin cookie de usuario: no se puede restaurar la sesión.
    document.cookie = `omero_session=${jwt(Math.floor(Date.now() / 1000) + 3600)}; Path=/`
    auth = { isAuthenticated: false, isLoading: false, syncSession }
    render(<ProtectedRoute><p>POS</p></ProtectedRoute>)
    expect(screen.getByRole('status')).toHaveTextContent('Redirigiendo…')
    expect(replace).toHaveBeenCalledWith('/login')
    expect(document.cookie).not.toContain('omero_session=')
  })

  it('regresión relanzamiento en blanco: si la sesión se renovó fuera del provider, se relee y NO rebota al login (bucle /login ↔ /pos)', () => {
    syncSession.mockReturnValue(true) // el login renovó el JWT con la caja y navegó al POS
    auth = { isAuthenticated: false, isLoading: false, syncSession }
    render(<ProtectedRoute><p>POS</p></ProtectedRoute>)
    expect(syncSession).toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
  })
})
