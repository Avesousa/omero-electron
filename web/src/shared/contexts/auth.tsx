'use client'

import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { postLogin, postLoginKey, postLogout, SESSION_ACTIVE } from '@/shared/services/authService'
import {
  setSession,
  clearSession,
  getSessionUser,
  getAuthToken,
  getStoredRefreshToken,
  hasRefreshHint,
  hasRefreshToken,
  refreshSession,
  handleSessionLost,
  lostReasonFrom,
  startSessionRenewal,
  stopSessionRenewal,
} from '@/lib/sessionManager'
import { logoutWarning, pendingOutboxCount, wipeLocalCatalogCache } from '@/lib/localCache'
import { deviceLogout, fetchDeviceInfo, syncDeviceSessionCookie } from '@/lib/deviceSession'
import { saveLoginHint } from '@/lib/loginHint'
import { useSessionRenewal } from '@/lib/useSessionRenewal'
import type { AuthContextValue, AuthState, LoginCredentials, SessionConflict } from '@/shared/types/auth'

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [state, setState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
    error: null,
  })

  const [sessionConflict, setSessionConflict] = useState<SessionConflict | null>(null)
  const pendingLogin = useRef<LoginCredentials | null>(null)

  useEffect(() => {
    let cancelled = false
    // MODO WEB: el middleware deja pasar con JWT vencido si hay `omero_has_refresh`: acá se renueva o se redirige. Una caja de
    // escritorio nunca guarda refresh token ni esa cookie, así que estas ramas no la tocan (su renovación es `useSessionRenewal`).
    const hadHint = hasRefreshHint()
    try {
      const user = getSessionUser()
      setState({ user, isAuthenticated: !!user, isLoading: false, error: null })

      if (user && hasRefreshToken()) {
        startSessionRenewal()
        if (!getAuthToken()) {
          void refreshSession().then(r => {
            if (!r.ok && r.reason !== 'network' && !cancelled) handleSessionLost(lostReasonFrom(r))
          })
        }
      } else if (!user && hadHint && !window.location.pathname.startsWith('/login')) {
        handleSessionLost('expired')
      }
    } catch {
      clearSession()
      setState({ user: null, isAuthenticated: false, isLoading: false, error: null })
    }
    return () => {
      cancelled = true
      stopSessionRenewal()
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

  // Desktop con caja registrada: el JWT de caja se renueva al hacer falta. Si ya no se puede (revocada/vencida) se vuelve al login.
  useSessionRenewal({
    authenticated: state.isAuthenticated,
    onSessionLost: (reason) => {
      clearSession()
      setState({ user: null, isAuthenticated: false, isLoading: false, error: null })
      router.push(`/login?reason=${reason}`)
    },
  })

  /** ¿Esta instalación es una caja de escritorio con identidad de dispositivo? (el servidor local lo sabe; en web: false). */
  const isDeviceMode = useCallback(async (): Promise<boolean> => {
    try {
      const info = await fetchDeviceInfo()
      return info.desktop && info.hasDevice
    } catch {
      return false
    }
  }, [])

  const performLogin = useCallback(async (credentials: LoginCredentials, replaceSession: boolean) => {
    const { redirectTo } = credentials
    setState(s => ({ ...s, isLoading: true, error: null }))

    try {
      const result = 'key' in credentials
        ? await postLoginKey({ tenantId: credentials.tenantId, key: credentials.key, ...(replaceSession ? { replaceSession: true } : {}) })
        : await postLogin({ email: credentials.email, password: credentials.password, ...(replaceSession ? { replaceSession: true } : {}) })

      if (!result.success) {
        // 409 SESSION_ACTIVE es solo del login WEB; los logins de caja llevan `device` y el backend no se lo devuelve. Si igual
        // llegara en una caja, no se ofrece reemplazar: se muestra como error normal.
        if (result.code === SESSION_ACTIVE && !(await isDeviceMode())) {
          pendingLogin.current = credentials
          // El backend manda lastSeenAt dentro de `data` (envelope); se acepta también en la raíz.
          setSessionConflict({ lastSeenAt: result.data?.lastSeenAt ?? result.lastSeenAt })
          setState(s => ({ ...s, isLoading: false }))
          return
        }
        setState(s => ({ ...s, isLoading: false, error: result.error || 'Error al iniciar sesión.' }))
        return
      }

      pendingLogin.current = null
      setSessionConflict(null)
      const { accessToken: jwt, refreshToken, user } = result.data
      // Caja (identidad de dispositivo registrada por el servidor local): el refresh token que venga NO se usa (se descarta);
      // su sesión es la de dispositivo. Sin caja (modo web): sesión renovable con refresh token.
      const device = await isDeviceMode()
      setSession(jwt, user, device ? null : refreshToken)
      if (device) void syncDeviceSessionCookie()
      else startSessionRenewal()
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
  }, [router, isDeviceMode])

  const login = useCallback((credentials: LoginCredentials) => performLogin(credentials, false), [performLogin])

  const confirmReplaceSession = useCallback(async () => {
    const credentials = pendingLogin.current
    if (!credentials) return
    await performLogin(credentials, true)
  }, [performLogin])

  const dismissSessionConflict = useCallback(() => {
    pendingLogin.current = null
    setSessionConflict(null)
  }, [])

  const logout = useCallback(() => {
    void (async () => {
      // Desktop: si hay ventas/gastos sin subir se avisa (NO se borran: el outbox sobrevive al logout y se sube al
      // volver a iniciar sesión con conexión).
      const pending = await pendingOutboxCount()
      if (pending > 0 && typeof window !== 'undefined' && !window.confirm(logoutWarning(pending))) return
      // Modo web: revoca la sesión en el backend (best effort, con el refresh token antes de limpiar). La caja no tiene refresh
      // token: su logout es `deviceLogout`.
      const refreshToken = hasRefreshToken() ? getStoredRefreshToken() : null
      if (refreshToken) void postLogout(refreshToken)
      stopSessionRenewal()
      deviceLogout() // desktop: la caja sigue registrada (sube lo pendiente) pero renovar exigirá un nuevo login
      wipeLocalCatalogCache() // desktop: borra la caché SQLite del tenant (antes de limpiar el token). Solo logout explícito.
      clearSession()
      setState({ user: null, isAuthenticated: false, isLoading: false, error: null })
      router.push('/login')
    })()
  }, [router])

  return (
    <AuthContext.Provider value={{ ...state, login, logout, syncSession, sessionConflict, confirmReplaceSession, dismissSessionConflict }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
