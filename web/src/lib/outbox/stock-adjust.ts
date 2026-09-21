import type { CatalogRoute } from '../catalog/types'
import { getOutboxStore } from './outbox-registry'

/**
 * Stock que ve el POS = stock del backend − lo vendido que el backend todavía no descontó (ventas del outbox
 * PENDING, o enviadas después del último snapshot de la caché), con piso en 0 (el backend tampoco baja de 0).
 *
 * Solo se ajusta la RESPUESTA: la caché SQLite del catálogo guarda siempre el valor crudo del backend, así que
 * el ajuste nunca se acumula ni se descuenta dos veces. El código `000` (precio libre) no maneja stock.
 */

type ProductJson = { code?: unknown; stock?: unknown } & Record<string, unknown>

function adjustOne(product: unknown, quantities: Map<string, number>): boolean {
  if (product === null || typeof product !== 'object') return false
  const p = product as ProductJson
  const qty = quantities.get(String(p.code ?? ''))
  if (!qty || typeof p.stock !== 'number' || !Number.isFinite(p.stock)) return false
  const next = Math.max(0, p.stock - qty)
  if (next === p.stock) return false
  p.stock = next
  return true
}

/**
 * Devuelve el body con el stock ajustado (o el mismo texto si no hay nada que ajustar / no es el formato esperado).
 * `since` = fecha del snapshot de donde salen los datos; `undefined` = respuesta en vivo del backend.
 */
export function adjustStockBody(
  tenantId: string,
  route: CatalogRoute,
  body: string,
  options: { since?: string | null } = {},
): string {
  if (route.kind !== 'products' && route.kind !== 'product') return body
  try {
    const store = getOutboxStore(tenantId)
    if (!store) return body
    const quantities = store.activeSaleQuantities(options)
    if (quantities.size === 0) return body // camino rápido: sin parsear el JSON

    const parsed = JSON.parse(body) as { data?: unknown }
    let changed = false
    if (Array.isArray(parsed?.data)) {
      for (const p of parsed.data) changed = adjustOne(p, quantities) || changed
    } else if (parsed?.data) {
      changed = adjustOne(parsed.data, quantities)
    }
    return changed ? JSON.stringify(parsed) : body
  } catch (err) {
    console.warn(`[outbox] no se pudo ajustar el stock: ${(err as Error).message}`)
    return body
  }
}
