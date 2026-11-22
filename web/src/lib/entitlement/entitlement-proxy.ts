import { proxyToBackend } from '../backend-proxy'
import { tenantFromAuthHeader } from '../catalog/tenant'
import { parseEntitlement } from './rule'
import { readEntitlement, touchEntitlement, writeEntitlement } from './store'

/**
 * `GET /api/billing/entitlement` en desktop (read-through con caché persistente, igual criterio que el catálogo):
 *
 *   backend 200 con forma válida → guarda `{entitlement, fetchedAt, etag}` en disco y devuelve la respuesta (sin `ETag`)
 *   backend 304                  → 200 con lo guardado, `X-Omero-Cache: fresh` (dato confirmado vigente) y `fetchedAt` nuevo
 *   backend 502/503/504 + caché  → 200 con lo último conocido, `X-Omero-Cache: hit` y `X-Omero-Cache-At` = fetchedAt
 *   cualquier otra respuesta     → pasa sin modificar (401/403/404 son respuestas REALES)
 *
 * El ETag lo posee este servidor local: el `If-None-Match` del navegador se descarta, se manda el propio (solo si hay
 * entitlement guardado) y el `ETag` nunca sale hacia el navegador. `fresh` ≠ `hit`: `hit` es "sin conexión, dato
 * posiblemente viejo" y el renderer no desbloquea con él.
 *
 * La caché se refresca cada vez que el renderer consulta (al iniciar, al volver la conexión y cada ~5 min). La usa
 * `outbox-proxy` para bloquear la venta ANTES de encolarla, también offline.
 */

const CACHEABLE_FAILURES = new Set([502, 503, 504])

export function isEntitlementRoute(method: string, pathname: string): boolean {
  return method.toUpperCase() === 'GET' && pathname.replace(/\/+$/, '') === '/api/billing/entitlement'
}

/** Copia de la request sin el `If-None-Match` del navegador (opcionalmente con el propio). */
function withValidator(request: Request, etag: string | null): Request {
  const headers = new Headers(request.headers)
  headers.delete('if-none-match')
  if (etag) headers.set('If-None-Match', etag)
  return new Request(request, { headers })
}

export async function handleEntitlementRequest(request: Request): Promise<Response> {
  const authorization = request.headers.get('authorization')
  const tenantId = tenantFromAuthHeader(authorization)
  if (!tenantId) return proxyToBackend(withValidator(request, null))

  const validator = readEntitlement(tenantId)?.etag ?? null
  const upstream = await proxyToBackend(withValidator(request, validator))

  if (upstream.status === 304 && validator) {
    const cached = touchEntitlement(tenantId)
    if (cached) {
      await upstream.body?.cancel().catch(() => {})
      return new Response(JSON.stringify({ success: true, data: cached.entitlement }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Omero-Cache': 'fresh' },
      })
    }
    return proxyToBackend(withValidator(request, null)) // sin nada que servir: se pide completo
  }

  if (upstream.status === 200) {
    const text = await upstream.text()
    try {
      const parsed = parseEntitlement((JSON.parse(text) as { data?: unknown } | null)?.data)
      // Sin header ETag en el 200 (backend viejo) se borra el guardado: comportamiento de antes.
      if (parsed) writeEntitlement(tenantId, parsed, Date.now(), process.env, upstream.headers.get('etag'))
    } catch {
      /* cuerpo inesperado: pasa igual, la caché no se toca */
    }
    const headers = new Headers(upstream.headers)
    headers.delete('content-length') // el body se re-armó desde texto
    headers.delete('etag') // el ETag es de este servidor local, no del navegador
    headers.set('Cache-Control', 'no-store')
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
