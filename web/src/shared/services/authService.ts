import { apiFetch } from '@/lib/apiClient'
import type { LoginData } from '@/shared/types/auth'

export interface LoginRequest {
  email: string
  password: string
}

export async function postLogin(credentials: LoginRequest) {
  return apiFetch<LoginData>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(credentials),
  })
}
