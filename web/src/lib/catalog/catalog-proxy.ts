import { proxyToBackend } from '../backend-proxy'
import { adjustCustomersBody } from '../customers/customers-adjust'
import { adjustStockBody } from '../outbox/stock-adjust'
import { matchCatalogRoute } from './cache-policy'
import { parseProductsEtag, withStockVersion } from './etag'
import { applyCatalogPayload, CUSTOMER_FIELDS_SETTING, CUSTOMERS_SETTING, customerDetailKey, etagKeyOf, itemBody, listBody, parseStockDelta, PAYMENT_METHODS_SETTING, storedValidatorOf } from './snapshot'
import { getCatalogStore } from './store-registry'
import { rememberSession } from '../outbox/outbox-runtime'
import { permissionsFromAuthHeader, tenantFromAuthHeader } from './tenant'
import type { CatalogRoute, CatalogStore } from './types'

/**
 * Lectura resiliente del catálogo (solo desktop). Para las rutas de la política (`cache-policy.ts`):
 *
 *   backend 200                 → actualiza SQLite (snapshot o upsert) y devuelve la respuesta tal cual
 *   backend 502/503/504 + datos → responde desde SQLite con `X-Omero-Cache: hit` (+ fecha y antigüedad)
 *   cualquier otra respuesta    → pasa sin modificar (401/403/404/500 son respuestas REALES del backend)
 *
 * Con ETag (products, promotions, configuración): si hay snapshot local y ETag guardado se manda `If-None-Match` PROPIO
 * (el del navegador se descarta y el ETag nunca sale hacia él); un 304 se sirve desde SQLite con `X-Omero-Cache: fresh`.
 * `GET /api/products/stock?since=` (delta) se fusiona en SQLite y se responde ajustado con lo pendiente del outbox.
 *
 * En ambos casos el stock de `products` se muestra como stock − ventas pendientes del outbox (`stock-adjust`).
 * `proxyToBackend` ya mapea red caída → 502 y timeout → 504, así que "sin conexión" llega acá como 502/504.
 * Cualquier error de la caché se traga y se loguea: la caché jamás debe romper una request.
 */

const CACHEABLE_FAILURES = new Set([502, 503, 504])

/**
 * El snapshot de medios de pago es por tenant, no por usuario: puede haberlo tomado alguien con `POS_CREDITO_USAR`.
 * Al servirlo offline se saca el medio Crédito si el JWT de quien pregunta no trae ese permiso (o no trae permisos).
 */
export function filterPaymentMethodsBody(body: string, authorization: string | null | undefined): string {
  if (permissionsFromAuthHeader(authorization)?.includes('POS_CREDITO_USAR')) return body
  try {
    const parsed: unknown = JSON.parse(body)
    const wrapped = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) && Array.isArray((parsed as { data?: unknown }).data)
    const list = wrapped ? (parsed as { data: unknown[] }).data : Array.isArray(parsed) ? parsed : null
    if (!list) return body
    const kept = list.filter(m => (m as { kind?: string } | null)?.kind !== 'CREDIT')
    return JSON.stringify(wrapped ? { ...(parsed as object), data: kept } : kept)
  } catch {
    return body
  }
}

/**
 * `fresh` = el backend confirmó con un 304 que el snapshot está al día (dato vigente). `hit` = sin conexión (dato
 * posiblemente viejo): es lo que `useEntitlement` y la UI usan para no dar por bueno el dato.
 */
type CacheMode = 'hit' | 'fresh'

/** Versión de stock del snapshot de productos (del ETag guardado), para que el navegador pida el delta. */
function stockVersionOf(store: CatalogStore): string | null {
  try {
    const parsed = parseProductsEtag(store.getEtag('products'))
    return parsed ? String(parsed.stock) : null
  } catch {
    return null
  }
}

function serveFromCache(
  store: CatalogStore,
  route: CatalogRoute,
  tenantId: string,
  authorization?: string | null,
  mode: CacheMode = 'hit',
): Response | null {
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
    case 'paymentMethods': {
      const setting = store.getSetting(PAYMENT_METHODS_SETTING)
      if (!setting) return null
      body = filterPaymentMethodsBody(itemBody(setting.json), authorization) // el JSON guardado ya es el array de medios
      syncedAt = setting.syncedAt
      break
    }
    case 'customers':
    case 'customerFields':
    case 'customerDetail': {
      // Clientes (crédito/fiado): lista y detalle se guardan como configuración; el detalle solo existe si se consultó antes.
      const key =
        route.kind === 'customers' ? CUSTOMERS_SETTING : route.kind === 'customerFields' ? CUSTOMER_FIELDS_SETTING : customerDetailKey(route.id)
      const setting = store.getSetting(key)
      if (!setting) return null
      body = itemBody(setting.json)
      syncedAt = setting.syncedAt
      break
    }
    case 'stockDelta':
      return null // el delta nunca se sirve desde la caché (ver `proxyStockDelta`)
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
  body = adjustCustomersBody(tenantId, route, body, { since: syncedAt })

  const headers = new Headers({
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Omero-Cache': mode,
  })
  if (route.kind === 'products') {
    const stockVersion = stockVersionOf(store)
    if (stockVersion) headers.set('X-Omero-Stock-Version', stockVersion)
  }
  if (syncedAt && mode === 'hit') {
    headers.set('X-Omero-Cache-At', syncedAt)
    headers.set('X-Omero-Cache-Age', String(Math.max(0, Math.floor((Date.now() - Date.parse(syncedAt)) / 1000))))
  }
  return new Response(body, { status: 200, headers })
}

/** Copia de la request sin el `If-None-Match` del navegador (opcionalmente con el propio). */
function withValidator(request: Request, etag: string | null): Request {
  const headers = new Headers(request.headers)
  headers.delete('if-none-match')
  if (etag) headers.set('If-None-Match', etag)
  return new Request(request, { headers })
}

/**
 * `GET /api/products/stock?since=<n>`: 200 → se fusiona en SQLite (y se recompone el ETag de `products` si SQLite estaba
 * al día hasta `since`) y la respuesta sale ajustada con lo PENDIENTE del outbox. Cualquier otra respuesta (410 de
 * versión vencida, 400, 404, 502/503/504 sin conexión) pasa tal cual: el navegador decide pedir el catálogo completo.
 */
async function proxyStockDelta(
  request: Request,
  route: Extract<CatalogRoute, { kind: 'stockDelta' }>,
  store: CatalogStore,
  tenantId: string,
): Promise<Response> {
  const upstream = await proxyToBackend(withValidator(request, null))
  if (upstream.status !== 200) return upstream

  const text = await upstream.text()
  try {
    const delta = parseStockDelta(text)
    if (delta) {
      store.applyStockDelta(delta.items)
      // Solo si SQLite ya tenía todo hasta `since` y el delta no retrocede: si no, el ETag prometería datos que faltan.
      const current = parseProductsEtag(store.getEtag('products'))
      if (current && route.since <= current.stock && delta.version >= current.stock) {
        const next = withStockVersion(store.getEtag('products'), delta.version)
        if (next) store.setEtag('products', next)
      }
    }
  } catch (err) {
    console.warn(`[catalog] no se pudo aplicar el delta de stock: ${(err as Error).message}`)
  }
  const headers = new Headers(upstream.headers)
  headers.delete('content-length') // el body se re-armó desde texto
  headers.delete('etag')
  headers.set('Cache-Control', 'no-store')
  return new Response(adjustStockBody(tenantId, route, text), { status: 200, statusText: upstream.statusText, headers })
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

  if (route.kind === 'stockDelta') return proxyStockDelta(request, route, store, tenantId)

  // El ETag lo posee este servidor local: el `If-None-Match` del navegador se descarta y se manda el propio (si hay).
  const etagKey = etagKeyOf(route)
  const validator = storedValidatorOf(store, route)
  const upstream = await proxyToBackend(withValidator(request, validator))

  if (upstream.status === 304 && validator && etagKey) {
    try {
      store.touch(etagKey)
      const fresh = serveFromCache(store, route, tenantId, authorization, 'fresh')
      if (fresh) {
        await upstream.body?.cancel().catch(() => {})
        return fresh
      }
    } catch (err) {
      console.warn(`[catalog] no se pudo servir el 304 desde la caché: ${(err as Error).message}`)
    }
    // Sin datos locales que servir: se descarta el validador y se pide completo.
    try {
      store.setEtag(etagKey, null)
    } catch {
      /* la caché no debe romper la request */
    }
    return proxyToBackend(withValidator(request, null))
  }

  if (upstream.status === 200) {
    const text = await upstream.text()
    try {
      // Sin header ETag en el 200 (backend viejo) se borra el guardado: comportamiento de antes.
      applyCatalogPayload(store, route, text, etagKey ? upstream.headers.get('etag') : undefined)
    } catch (err) {
      console.warn(`[catalog] no se pudo actualizar la caché: ${(err as Error).message}`)
    }
    const headers = new Headers(upstream.headers)
    headers.delete('content-length') // el body se re-armó desde texto
    if (etagKey) {
      // El body sale ajustado (stock − pendientes): el ETag del backend no le corresponde al navegador.
      headers.delete('etag')
      headers.set('Cache-Control', 'no-store')
      if (route.kind === 'products') {
        const stockVersion = stockVersionOf(store)
        if (stockVersion) headers.set('X-Omero-Stock-Version', stockVersion)
      }
    }
    // Respuesta en vivo: el backend ya descontó lo enviado; solo falta restar lo PENDIENTE del outbox.
    const adjusted = adjustCustomersBody(tenantId, route, adjustStockBody(tenantId, route, text))
    return new Response(adjusted, { status: 200, statusText: upstream.statusText, headers })
  }

  if (CACHEABLE_FAILURES.has(upstream.status)) {
    try {
      const cached = serveFromCache(store, route, tenantId, authorization)
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
