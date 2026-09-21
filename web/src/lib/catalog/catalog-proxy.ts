import { proxyToBackend } from '../backend-proxy'
import { adjustStockBody } from '../outbox/stock-adjust'
import { matchCatalogRoute } from './cache-policy'
import { applyCatalogPayload, itemBody, listBody } from './snapshot'
import { getCatalogStore } from './store-registry'
import { rememberSession } from '../outbox/outbox-runtime'
import { tenantFromAuthHeader } from './tenant'
import type { CatalogRoute, CatalogStore } from './types'

/**
 * Lectura resiliente del catálogo (solo desktop). Para las rutas de la política (`cache-policy.ts`):
 *
 *   backend 200                 → actualiza SQLite (snapshot o upsert) y devuelve la respuesta tal cual
 *   backend 502/503/504 + datos → responde desde SQLite con `X-Omero-Cache: hit` (+ fecha y antigüedad)
 *   cualquier otra respuesta    → pasa sin modificar (401/403/404/500 son respuestas REALES del backend)
 *
 * En ambos casos el stock de `products` se muestra como stock − ventas pendientes del outbox (`stock-adjust`).
 * `proxyToBackend` ya mapea red caída → 502 y timeout → 504, así que "sin conexión" llega acá como 502/504.
 * Cualquier error de la caché se traga y se loguea: la caché jamás debe romper una request.
 */

const CACHEABLE_FAILURES = new Set([502, 503, 504])

function serveFromCache(store: CatalogStore, route: CatalogRoute, tenantId: string): Response | null {
  let body: string
  let syncedAt: string | null

  switch (route.kind) {
    case 'products': {
      const meta = store.getMeta('products')
      if (!meta) return null // nunca hubo un snapshot completo: no se sirve una lista parcial
      body = listBody(store.getProducts())
      syncedAt = meta.lastSyncAt
      break
    }
    case 'promotions': {
      const meta = store.getMeta('promotions')
      if (!meta) return null
      body = listBody(store.getPromotions())
      syncedAt = meta.lastSyncAt
      break
    }
    case 'setting': {
      const setting = store.getSetting(route.key)
      if (!setting) return null
      body = itemBody(setting.json)
      syncedAt = setting.syncedAt
      break
    }
    case 'product': {
      const json = store.findProduct(route.code)
      if (!json) return null
      body = itemBody(json)
      syncedAt = store.getMeta('products')?.lastSyncAt ?? null
      break
    }
  }

  // La caché guarda el stock crudo del backend; lo vendido sin sincronizar se descuenta recién al responder.
  body = adjustStockBody(tenantId, route, body, { since: syncedAt })

  const headers = new Headers({
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Omero-Cache': 'hit',
  })
  if (syncedAt) {
    headers.set('X-Omero-Cache-At', syncedAt)
    headers.set('X-Omero-Cache-Age', String(Math.max(0, Math.floor((Date.now() - Date.parse(syncedAt)) / 1000))))
  }
  return new Response(body, { status: 200, headers })
}

export async function proxyWithCatalog(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const route = matchCatalogRoute(request.method, url.pathname, url.search)
  const authorization = request.headers.get('authorization')
  const tenantId = tenantFromAuthHeader(authorization)
  if (!route || !tenantId || !authorization) return proxyToBackend(request)

  const store = getCatalogStore(tenantId)
  if (!store) return proxyToBackend(request)

  rememberSession(tenantId, authorization)

  const upstream = await proxyToBackend(request)

  if (upstream.status === 200) {
    const text = await upstream.text()
    try {
      applyCatalogPayload(store, route, text)
    } catch (err) {
      console.warn(`[catalog] no se pudo actualizar la caché: ${(err as Error).message}`)
    }
    const headers = new Headers(upstream.headers)
    headers.delete('content-length') // el body se re-armó desde texto
    // Respuesta en vivo: el backend ya descontó lo enviado; solo falta restar lo PENDIENTE del outbox.
    return new Response(adjustStockBody(tenantId, route, text), { status: 200, statusText: upstream.statusText, headers })
  }

  if (CACHEABLE_FAILURES.has(upstream.status)) {
    try {
      const cached = serveFromCache(store, route, tenantId)
      if (cached) {
        await upstream.body?.cancel().catch(() => {})
        return cached
      }
    } catch (err) {
      console.warn(`[catalog] no se pudo leer la caché: ${(err as Error).message}`)
    }
  }
  return upstream
}
