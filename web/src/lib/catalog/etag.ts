/**
 * ETag de `GET /api/products` del backend: `"<versión catálogo>-<versión stock>"` (ambos enteros, entre comillas).
 * Cualquier otra forma (débil, sin guion, no numérica) se trata como "no sabemos": sin delta de stock, comportamiento
 * anterior a la caché con ETag.
 */

const PRODUCTS_ETAG = /^"(\d{1,18})-(\d{1,18})"$/

export interface ProductsEtag {
  /** Versión del catálogo (texto, solo se compara). */
  cat: string
  /** Versión de stock (la misma numeración que `GET /api/products/stock?since=`). */
  stock: number
}

export function parseProductsEtag(etag: string | null | undefined): ProductsEtag | null {
  if (!etag) return null
  const match = PRODUCTS_ETAG.exec(etag.trim())
  if (!match) return null
  const stock = Number(match[2])
  return Number.isSafeInteger(stock) ? { cat: match[1], stock } : null
}

/** Recompone el ETag con otra versión de stock (tras aplicar un delta). `null` si el ETag no tiene el formato esperado. */
export function withStockVersion(etag: string | null | undefined, stock: number): string | null {
  const parsed = parseProductsEtag(etag)
  if (!parsed || !Number.isSafeInteger(stock) || stock < 0) return null
  return `"${parsed.cat}-${stock}"`
}
