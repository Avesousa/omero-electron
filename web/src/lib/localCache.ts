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

/**
 * Cantidad de ventas/gastos guardados en esta caja que todavía no se subieron (desktop). 0 en web, sin sesión o si el
 * servidor local no responde: el aviso de logout es best-effort y jamás debe impedir cerrar sesión.
 */
export async function pendingOutboxCount(): Promise<number> {
  try {
    const headers = authHeaders()
    if (!headers.Authorization) return 0
    const res = await fetch('/api/_local/outbox?status=PENDING&limit=1', { headers, cache: 'no-store' })
    const body = (await res.json()) as { data?: { available?: boolean; counts?: { pending?: number } } }
    return body?.data?.available ? Number(body.data.counts?.pending) || 0 : 0
  } catch {
    return 0
  }
}

export function logoutWarning(pending: number): string {
  return (
    `Hay ${pending} venta${pending !== 1 ? 's' : ''}/gasto${pending !== 1 ? 's' : ''} sin subir al servidor. ` +
    'Cerrar sesión NO las borra: se suben cuando vuelvas a iniciar sesión con conexión. ¿Cerrar sesión igual?'
  )
}
