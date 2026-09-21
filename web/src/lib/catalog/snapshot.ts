import type { CatalogRoute, CatalogStore, ProductLike, PromotionLike } from './types'

/**
 * Aplica a la caché el cuerpo de una respuesta 200 del backend (`{ success: true, data }`).
 * Es defensivo: si la forma no es la esperada NO toca la caché (mejor datos viejos que datos corruptos).
 */

/** `data` de un envelope `{ success: true, data }`, o undefined si el texto no lo es. */
export function parseEnvelopeData(text: string): unknown {
  try {
    const body: unknown = JSON.parse(text)
    if (body !== null && typeof body === 'object' && (body as { success?: unknown }).success === true) {
      return (body as { data?: unknown }).data
    }
  } catch {
    /* JSON inválido */
  }
  return undefined
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

const isProduct = (v: unknown): v is ProductLike =>
  isObject(v) && v.id != null && typeof v.code === 'string'
const isPromotion = (v: unknown): v is PromotionLike => isObject(v) && v.id != null

/** true si se actualizó la caché. */
export function applyCatalogPayload(store: CatalogStore, route: CatalogRoute, text: string): boolean {
  const data = parseEnvelopeData(text)
  if (data === undefined) return false

  switch (route.kind) {
    case 'products':
      if (!Array.isArray(data) || !data.every(isProduct)) return false
      store.replaceProducts(data)
      return true
    case 'promotions':
      if (!Array.isArray(data) || !data.every(isPromotion)) return false
      store.replacePromotions(data)
      return true
    case 'product':
      if (!isProduct(data)) return false
      store.upsertProduct(data)
      return true
    case 'setting':
      if (!isObject(data)) return false
      store.upsertSetting(route.key, JSON.stringify(data))
      return true
  }
}

/** Cuerpo `{ success: true, data: [...] }` armado con JSON crudo (sin parsear ni re-serializar cada ítem). */
export function listBody(jsonItems: string[]): string {
  return `{"success":true,"data":[${jsonItems.join(',')}]}`
}

export function itemBody(jsonItem: string): string {
  return `{"success":true,"data":${jsonItem}}`
}
