import { renewSession, reasonFor } from '@/lib/deviceSession'
import { authHeaders, clearSession } from '@/lib/sessionManager'
import { handleSubscriptionResponse } from '@/lib/subscriptionGate'

export async function apiFetch<T = unknown>(
  path: string,
  options?: RequestInit,
  renewed = false,
): Promise<{ success: true; data: T } | { success: false; error: string }> {
  const isFormData = options?.body instanceof FormData
  const res = await fetch(path, {
    ...options,
    headers: isFormData
      ? { ...authHeaders(), ...options?.headers }
      : { 'Content-Type': 'application/json', ...authHeaders(), ...options?.headers },
  })

  if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/api/auth/')) {
    // Caja registrada: el JWT venció (o el backend lo rechazó) y hay conexión → renovación OBLIGATORIA (obtener credencial) y
    // un único reintento, para no frenar la venta. Sin caja (web) `renewSession` responde NO_DEVICE y sigue el camino de siempre.
    if (!renewed) {
      const r = await renewSession()
      if (r.ok) return apiFetch<T>(path, options, true)
      if (r.code === 'UNAVAILABLE') return { success: false, error: 'Sin conexión con el servidor. Probá de nuevo en unos instantes.' }
      const reason = reasonFor(r.code)
      if (reason) {
        clearSession()
        window.location.href = `/login?reason=${reason}`
        return { success: false, error: 'Sesión expirada. Iniciá sesión nuevamente.' }
      }
    }
    clearSession()
    window.location.href = '/login'
    return { success: false, error: 'Sesión expirada. Iniciá sesión nuevamente.' }
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
    const endedReason = res.status === 403 && typeof window !== 'undefined' ? reasonFor(body?.code) : null
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
