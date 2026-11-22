import { parseProductsEtag } from '@/lib/catalog/etag'

/**
 * Delta de stock del cliente (`GET /api/products/stock?since=`): validación estricta y merge puro sobre la lista de productos.
 * El delta es estado ABSOLUTO (stock actual por código), no un evento: aplicarlo dos veces da lo mismo.
 */

export interface StockItem {
  code: string
  stock: number
}

export interface StockDelta {
  version: number
  items: StockItem[]
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** Valida la forma `{ version: entero >= 0, items: [{ code: string, stock: número finito }] }`. `null` si algo no cuadra. */
export function parseStockDelta(raw: unknown): StockDelta | null {
  if (!isRecord(raw)) return null
  const { version, items } = raw
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) return null
  if (!Array.isArray(items)) return null
  const parsed: StockItem[] = []
  for (const item of items) {
    if (!isRecord(item)) return null
    if (typeof item.code !== 'string' || item.code === '') return null
    if (typeof item.stock !== 'number' || !Number.isFinite(item.stock)) return null
    parsed.push({ code: item.code, stock: item.stock })
  }
  return { version, items: parsed }
}

/**
 * Aplica el stock de `items` a los productos con ese código. Los códigos desconocidos se ignoran.
 * Devuelve la MISMA lista (referencia) si no cambió nada, para no re-renderizar de más.
 */
export function mergeStock<T extends { code: string; stock: number }>(products: T[], items: StockItem[]): T[] {
  if (items.length === 0) return products
  const byCode = new Map(items.map((i) => [i.code, i.stock]))
  let changed = false
  const next = products.map((p) => {
    const stock = byCode.get(p.code)
    if (stock === undefined || stock === p.stock) return p
    changed = true
    return { ...p, stock }
  })
  return changed ? next : products
}

/** Versión de stock de una respuesta de productos: `X-Omero-Stock-Version` (desktop) o la del ETag (web). `null` si no hay. */
export function stockVersionOf(headers: Headers | null | undefined): number | null {
  if (!headers) return null
  const own = headers.get('X-Omero-Stock-Version')
  if (own !== null && /^\d{1,15}$/.test(own.trim())) return Number(own.trim())
  return parseProductsEtag(headers.get('ETag'))?.stock ?? null
}
