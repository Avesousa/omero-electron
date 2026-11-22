import type { CatalogRoute } from './types'

/**
 * Política de caché: qué lecturas del backend se sirven/actualizan desde SQLite.
 * Es una tabla explícita (no rutas dedicadas de Next) porque un segmento dinámico
 * `api/products/[code]` capturaría también `/api/products/search` y `/api/products/bulk-upload`.
 *
 * Solo GET, sin query string (el POS no envía filtros; con `?categoryId=` una lista cacheada sería incorrecta),
 * salvo `/api/products/stock?since=<n>` (delta de stock).
 * `{code}` debe ser numérico: los códigos, códigos de barras e ids del POS son números (se cargan por numpad),
 * lo que además descarta cualquier segmento con nombre (`search`, `bulk-upload`, …).
 *
 * Punto de extensión (fase 3): agregar aquí reglas de escritura.
 */

const PRODUCT_CODE = /^\d{1,20}$/
/** Claves de business_config (p. ej. `mp_offline`): solo alfanuméricas y guion bajo. */
const SETTING_KEY = /^[A-Za-z0-9_]{1,64}$/

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** La única variante cacheada de la lista de clientes: los activos (la que usa la caja). */
const CUSTOMERS_ACTIVE_QUERY = '?onlyActive=true'

/** Delta de stock: `?since=<versión>` (solo dígitos; cualquier otra query no es la del POS y pasa por el proxy). */
const STOCK_DELTA_QUERY = /^\?since=(\d{1,18})$/

export function matchCatalogRoute(method: string, pathname: string, search: string): CatalogRoute | null {
  if (method.toUpperCase() !== 'GET') return null

  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname

  // Clientes (crédito/fiado): la lista cacheada es SOLO `?onlyActive=true`; otras variantes (`onlyActive=false`) no se cachean.
  if (path === '/api/customers') return search === CUSTOMERS_ACTIVE_QUERY ? { kind: 'customers' } : null

  // Delta de stock: es la única ruta de productos con query cacheable (la respuesta depende de `since`).
  if (path === '/api/products/stock') {
    const since = STOCK_DELTA_QUERY.exec(search)
    return since ? { kind: 'stockDelta', since: Number(since[1]) } : null
  }

  if (search !== '' && search !== '?') return null

  if (path === '/api/customers/fields') return { kind: 'customerFields' }
  const detail = /^\/api\/customers\/([^/]+)\/detail$/.exec(path)
  if (detail) return UUID_SEGMENT.test(detail[1]) ? { kind: 'customerDetail', id: detail[1].toLowerCase() } : null

  if (path === '/api/products') return { kind: 'products' }
  if (path === '/api/promotions') return { kind: 'promotions' }
  if (path === '/api/payment-methods/active') return { kind: 'paymentMethods' }

  const configPrefix = '/api/business/config/'
  if (path.startsWith(configPrefix)) {
    const key = path.slice(configPrefix.length)
    return SETTING_KEY.test(key) ? { kind: 'setting', key } : null
  }

  const prefix = '/api/products/'
  if (path.startsWith(prefix)) {
    const code = path.slice(prefix.length)
    if (PRODUCT_CODE.test(code)) return { kind: 'product', code }
  }
  return null
}
