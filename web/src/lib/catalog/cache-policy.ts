import type { CatalogRoute } from './types'

/**
 * Política de caché: qué lecturas del backend se sirven/actualizan desde SQLite.
 * Es una tabla explícita (no rutas dedicadas de Next) porque un segmento dinámico
 * `api/products/[code]` capturaría también `/api/products/search` y `/api/products/bulk-upload`.
 *
 * Solo GET, sin query string (el POS no envía filtros; con `?categoryId=` una lista cacheada sería incorrecta).
 * `{code}` debe ser numérico: los códigos, códigos de barras e ids del POS son números (se cargan por numpad),
 * lo que además descarta cualquier segmento con nombre (`search`, `bulk-upload`, …).
 *
 * Punto de extensión (fase 3): agregar aquí reglas de escritura.
 */

const PRODUCT_CODE = /^\d{1,20}$/

export function matchCatalogRoute(method: string, pathname: string, search: string): CatalogRoute | null {
  if (method.toUpperCase() !== 'GET') return null
  if (search !== '' && search !== '?') return null

  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname

  if (path === '/api/products') return { kind: 'products' }
  if (path === '/api/promotions') return { kind: 'promotions' }

  const prefix = '/api/products/'
  if (path.startsWith(prefix)) {
    const code = path.slice(prefix.length)
    if (PRODUCT_CODE.test(code)) return { kind: 'product', code }
  }
  return null
}
