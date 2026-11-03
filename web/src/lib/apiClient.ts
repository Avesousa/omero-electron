import { renewSession, reasonFor } from '@/lib/deviceSession'
import {
  authHeaders,
  clearSession,
  getAuthToken,
  getFreshAuthHeaders,
  handleSessionLost,
  hasRefreshToken,
  lostReasonFrom,
  markActivity,
  refreshSession,
} from '@/lib/sessionManager'
import { handleSubscriptionResponse } from '@/lib/subscriptionGate'

export type ApiResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string; lastSeenAt?: string; data?: { lastSeenAt?: string } }

const SESSION_EXPIRED_MESSAGE = 'Sesión expirada. Iniciá sesión nuevamente.'
const NETWORK_MESSAGE = 'No se pudo conectar con el servidor. Reintentá en unos segundos.'

/**
 * Dos mecanismos de sesión que NO se mezclan:
 *  - CAJA de escritorio (identidad de dispositivo): nunca guarda refresh token. Ante un 401 renueva con el servidor local
 *    (`renewSession`, renovación obligatoria) y reintenta UNA vez; un 403 DEVICE_* la corta.
 *  - MODO WEB (sin caja): sesión renovable con refresh token. Ante un 401 renueva (`refreshSession`, single-flight) y reintenta
 *    UNA vez; si la sesión se perdió (reemplazada / vencida) va a `/login?reason=replaced|expired`.
 * El discriminante es `hasRefreshToken()`: solo un login web lo guarda.
 */
export async function apiFetch<T = unknown>(
  path: string,
  options?: RequestInit,
  renewed = false,
): Promise<ApiResult<T>> {
  const isFormData = options?.body instanceof FormData
  const isAuthPath = path.startsWith('/api/auth/')
  const browser = typeof window !== 'undefined'
  markActivity()

  const send = async (): Promise<Response | null> => {
    // En rutas de auth no se espera ningún refresh (login/refresh/logout manejan su propio token).
    const auth = isAuthPath || !browser ? authHeaders() : await getFreshAuthHeaders()
    if (auth === null) return null // sesión web perdida: ya se redirigió a /login
    return fetch(path, {
      ...options,
      headers: isFormData
        ? { ...auth, ...options?.headers }
        : { 'Content-Type': 'application/json', ...auth, ...options?.headers },
    })
  }

  const sentWith = getAuthToken()
  let res = await send()
  if (res === null) return { success: false, error: SESSION_EXPIRED_MESSAGE }

  if (res.status === 401 && browser && !isAuthPath) {
    if (hasRefreshToken()) {
      // ── Modo web ──
      const refreshed = await refreshSession(sentWith ?? undefined)
      if (refreshed.ok) {
        res = (await send()) ?? res
        if (res.status === 401) {
          handleSessionLost('expired')
          return { success: false, error: SESSION_EXPIRED_MESSAGE }
        }
      } else if (refreshed.reason === 'network') {
        return { success: false, error: NETWORK_MESSAGE }
      } else {
        handleSessionLost(lostReasonFrom(refreshed))
        return { success: false, error: SESSION_EXPIRED_MESSAGE }
      }
    } else {
      // ── Caja de escritorio ──
      // El JWT venció (o el backend lo rechazó) y hay conexión → renovación OBLIGATORIA (obtener credencial) y un único
      // reintento, para no frenar la venta. Sin caja ni refresh (NO_DEVICE) sigue el camino de siempre.
      if (!renewed) {
        const r = await renewSession()
        if (r.ok) return apiFetch<T>(path, options, true)
        if (r.code === 'UNAVAILABLE') return { success: false, error: 'Sin conexión con el servidor. Probá de nuevo en unos instantes.' }
        const reason = reasonFor(r.code)
        if (reason) {
          clearSession()
          window.location.href = `/login?reason=${reason}`
          return { success: false, error: SESSION_EXPIRED_MESSAGE }
        }
      }
      clearSession()
      window.location.href = '/login'
      return { success: false, error: SESSION_EXPIRED_MESSAGE }
    }
  }

  // Error responses from Spring Security (401/403) have an empty body.
  const text = await res.text()
  if (!text) {
    return { success: false, error: res.ok ? 'Respuesta vacía del servidor.' : `Error ${res.status}` }
  }
  try {
    const body = JSON.parse(text)
    // 403 DEVICE_REVOKED / DEVICE_EXPIRED / LOGIN_REQUIRED: el backend cortó la caja (aunque el JWT siga vigente). Es un fin
    // DEFINITIVO: NO se renueva ni se reintenta (eso es solo para el 401); se vuelve al login con el motivo en español.
    const endedReason = res.status === 403 && browser ? reasonFor(body?.code) : null
    if (endedReason) {
      clearSession()
      window.location.href = `/login?reason=${endedReason}`
      return { success: false, error: typeof body.error === 'string' ? body.error : 'La sesión de esta caja terminó. Iniciá sesión nuevamente.' }
    }
    // 403 SUBSCRIPTION_INACTIVE: abre la pantalla bloqueante del POS (no cierra sesión ni revoca la caja).
    handleSubscriptionResponse(res.status, body)
    return body
  } catch {
    return { success: false, error: `Respuesta inválida del servidor (${res.status}).` }
  }
}
