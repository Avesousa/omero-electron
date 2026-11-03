import { apiFetch } from '@/lib/apiClient'
import type { LoginData } from '@/shared/types/auth'

export interface LoginRequest {
  email: string
  password: string
  /** Cierra la sesión web activa en otro lado y entra (tras un 409 SESSION_ACTIVE). Solo modo web. */
  replaceSession?: boolean
}

export interface KeyLoginRequest {
  tenantId: string
  key: string
  replaceSession?: boolean
}

export const SESSION_ACTIVE = 'SESSION_ACTIVE'

export async function postLogin(credentials: LoginRequest) {
  return apiFetch<LoginData>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(credentials),
  })
}

/** Login con clave numérica: misma respuesta que `postLogin`. En desktop el Next local también registra la caja. */
export async function postLoginKey(credentials: KeyLoginRequest) {
  return apiFetch<LoginData>('/api/auth/login-key', {
    method: 'POST',
    body: JSON.stringify(credentials),
  })
}

/** Revoca la sesión web en el backend. Best effort: nunca lanza. (La caja no lo usa: su logout es `deviceLogout`.) */
export async function postLogout(refreshToken: string | null): Promise<void> {
  try {
    await apiFetch('/api/auth/logout', {
      method: 'POST',
      body: JSON.stringify(refreshToken ? { refreshToken } : {}),
    })
  } catch {
    // el cierre local ya ocurrió; si el backend no responde la sesión expira sola
  }
}
