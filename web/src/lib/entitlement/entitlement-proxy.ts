import { proxyToBackend } from '../backend-proxy'
import { tenantFromAuthHeader } from '../catalog/tenant'
import { parseEntitlement } from './rule'
import { readEntitlement, writeEntitlement } from './store'

/**
 * `GET /api/billing/entitlement` en desktop (read-through con caché persistente, igual criterio que el catálogo):
 *
 *   backend 200 con forma válida → guarda `{entitlement, fetchedAt}` en disco y devuelve la respuesta tal cual
 *   backend 502/503/504 + caché  → 200 con lo último conocido, `X-Omero-Cache: hit` y `X-Omero-Cache-At` = fetchedAt
 *   cualquier otra respuesta     → pasa sin modificar (401/403/404 son respuestas REALES)
 *
 * La caché se refresca cada vez que el renderer consulta (al iniciar, al volver la conexión y cada ~5 min). La usa
 * `outbox-proxy` para bloquear la venta ANTES de encolarla, también offline.
 */

const CACHEABLE_FAILURES = new Set([502, 503, 504])

export function isEntitlementRoute(method: string, pathname: string): boolean {
  return method.toUpperCase() === 'GET' && pathname.replace(/\/+$/, '') === '/api/billing/entitlement'
}

export async function handleEntitlementRequest(request: Request): Promise<Response> {
  const authorization = request.headers.get('authorization')
  const tenantId = tenantFromAuthHeader(authorization)
  if (!tenantId) return proxyToBackend(request)

  const upstream = await proxyToBackend(request)

  if (upstream.status === 200) {
    const text = await upstream.text()
    try {
      const parsed = parseEntitlement((JSON.parse(text) as { data?: unknown } | null)?.data)
      if (parsed) writeEntitlement(tenantId, parsed)
    } catch {
      /* cuerpo inesperado: pasa igual, la caché no se toca */
    }
    const headers = new Headers(upstream.headers)
    headers.delete('content-length') // el body se re-armó desde texto
    return new Response(text, { status: 200, statusText: upstream.statusText, headers })
  }

  if (CACHEABLE_FAILURES.has(upstream.status)) {
    const cached = readEntitlement(tenantId)
    if (cached) {
      await upstream.body?.cancel().catch(() => {})
      return new Response(JSON.stringify({ success: true, data: cached.entitlement }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'X-Omero-Cache': 'hit',
          'X-Omero-Cache-At': cached.fetchedAt,
        },
      })
    }
  }
  return upstream
}
