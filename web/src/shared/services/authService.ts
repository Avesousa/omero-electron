import { apiFetch } from '@/lib/apiClient'
import type { LoginData } from '@/shared/types/auth'

export interface LoginRequest {
  email: string
  password: string
}

export interface KeyLoginRequest {
  tenantId: string
  key: string
}

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
