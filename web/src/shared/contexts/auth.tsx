'use client'

import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { postLogin, postLoginKey } from '@/shared/services/authService'
import { setSession, clearSession, getSessionUser } from '@/lib/sessionManager'
import { logoutWarning, pendingOutboxCount, wipeLocalCatalogCache } from '@/lib/localCache'
import { deviceLogout } from '@/lib/deviceSession'
import { saveLoginHint } from '@/lib/loginHint'
import { useSessionRenewal } from '@/lib/useSessionRenewal'
import type { AuthContextValue, AuthState, LoginCredentials } from '@/shared/types/auth'

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [state, setState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
    error: null,
  })

  useEffect(() => {
    try {
      const user = getSessionUser()
      setState({ user, isAuthenticated: !!user, isLoading: false, error: null })
    } catch {
      clearSession()
      setState({ user: null, isAuthenticated: false, isLoading: false, error: null })
    }
  }, [])

  // La sesión puede cambiar FUERA de este provider (p. ej. el login renovó el JWT en silencio con la caja y navegó al POS: el
  // provider vive en el layout raíz y NO se vuelve a montar). Sin esto el POS veía "sin sesión" y rebotaba al login en bucle.
  const syncSession = useCallback((): boolean => {
    let user = null
    try {
      user = getSessionUser()
    } catch {
      /* storage ilegible: sin sesión */
    }
    setState(s => (s.isAuthenticated === !!user && s.user?.id === user?.id && !s.isLoading
      ? s
      : { user, isAuthenticated: !!user, isLoading: false, error: null }))
    return !!user
  }, [])

  // Desktop con caja registrada: el JWT de 1 h se renueva solo. Si ya no se puede (revocada/vencida) se vuelve al login.
  useSessionRenewal({
    authenticated: state.isAuthenticated,
    onSessionLost: (reason) => {
      clearSession()
      setState({ user: null, isAuthenticated: false, isLoading: false, error: null })
      router.push(`/login?reason=${reason}`)
    },
  })

  const login = useCallback(async (credentials: LoginCredentials) => {
    const { redirectTo } = credentials
    setState(s => ({ ...s, isLoading: true, error: null }))

    try {
      const result = 'key' in credentials
        ? await postLoginKey({ tenantId: credentials.tenantId, key: credentials.key })
        : await postLogin({ email: credentials.email, password: credentials.password })

      if (!result.success) {
        setState(s => ({ ...s, isLoading: false, error: result.error || 'Error al iniciar sesión.' }))
        return
      }

      const { accessToken: jwt, user } = result.data
      setSession(jwt, user)
      // Recuerda el negocio de esta caja y si ofrece clave numérica (los próximos logins pueden usarla). No espera.
      void saveLoginHint({ tenantId: user.tenantId, quickKeyLoginEnabled: result.data.quickKeyLoginEnabled === true })
      setState({ user, isAuthenticated: true, isLoading: false, error: null })

      let destination = '/'

      if (redirectTo && redirectTo.startsWith('/')) {
        try {
          const res = await fetch(redirectTo, { method: 'HEAD', redirect: 'manual' })
          if (res.ok) destination = redirectTo
        } catch { }
      }

      router.push(destination)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al iniciar sesión.'
      setState(s => ({ ...s, isLoading: false, error: message }))
    }
  }, [router])

  const logout = useCallback(() => {
    void (async () => {
      // Desktop: si hay ventas/gastos sin subir se avisa (NO se borran: el outbox sobrevive al logout y se sube al
      // volver a iniciar sesión con conexión).
      const pending = await pendingOutboxCount()
      if (pending > 0 && typeof window !== 'undefined' && !window.confirm(logoutWarning(pending))) return
      deviceLogout() // desktop: la caja sigue registrada (sube lo pendiente) pero renovar exigirá un nuevo login
      wipeLocalCatalogCache() // desktop: borra la caché SQLite del tenant (antes de limpiar el token). Solo logout explícito.
      clearSession()
      setState({ user: null, isAuthenticated: false, isLoading: false, error: null })
      router.push('/login')
    })()
  }, [router])

  return (
    <AuthContext.Provider value={{ ...state, login, logout, syncSession }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
