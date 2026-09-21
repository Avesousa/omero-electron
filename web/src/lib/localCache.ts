import { authHeaders } from '@/lib/sessionManager'

/**
 * Pide al Next local (desktop) que borre la caché de catálogo del tenant de la sesión actual.
 * Se llama al CERRAR SESIÓN (no cuando el JWT vence: ahí la caché debe sobrevivir). Es best-effort: nunca lanza ni
 * bloquea el logout; en modo web el endpoint es un no-op (204). `keepalive` permite que termine aunque la
 * navegación al login cancele la request.
 */
export function wipeLocalCatalogCache(): void {
  try {
    const headers = authHeaders()
    if (!headers.Authorization) return // sin sesión no se puede identificar el tenant
    void fetch('/api/_local/cache', { method: 'DELETE', headers, keepalive: true }).catch(() => {})
  } catch {
    /* best-effort */
  }
}
