import { authHeaders, clearSession } from '@/lib/sessionManager'

export async function apiFetch<T = unknown>(
  path: string,
  options?: RequestInit
): Promise<{ success: true; data: T } | { success: false; error: string }> {
  const isFormData = options?.body instanceof FormData
  const res = await fetch(path, {
    ...options,
    headers: isFormData
      ? { ...authHeaders(), ...options?.headers }
      : { 'Content-Type': 'application/json', ...authHeaders(), ...options?.headers },
  })

  if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/api/auth/')) {
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
    return JSON.parse(text)
  } catch {
    return { success: false, error: `Respuesta inválida del servidor (${res.status}).` }
  }
}
