import { createHash } from 'node:crypto'
import { InvalidRequest, parseSale } from './outbox-proxy'
import type { OutboxStore } from './outbox-store'

/**
 * Importa al outbox SQLite la cola vieja del POS (`omero_purchase_queue` de localStorage). El navegador la lee y la
 * envía acá; SOLO cuando la respuesta confirma los ids importados los borra de su localStorage.
 *
 *   - Idempotente: el `clientId` se deriva de forma estable del id viejo (+ tenant), así importar dos veces la
 *     misma cola no duplica nada (y un reintento tras un corte a mitad tampoco).
 *   - Respeta `queuedAt` como `createdAt` (hora original de la venta).
 *   - Solo importa ítems del tenant de la sesión; los que no traen `tenantId` NO se importan (igual que hoy).
 *   - Los ítems inválidos se informan en `rejected` y NO se pierden: quedan en localStorage (el cliente no los borra).
 */

export interface LegacyQueuedPurchase {
  id?: unknown
  payload?: unknown
  queuedAt?: unknown
  tenantId?: unknown
}

export interface LegacyImportResult {
  /** Ids viejos ya presentes en el outbox (recién importados o ya importados antes): el cliente puede borrarlos. */
  imported: string[]
  /** Ids viejos que no se pudieron importar (inválidos), con el motivo. Siguen en localStorage. */
  rejected: { id: string; reason: string }[]
  /** Ids de otro tenant o sin tenant: se ignoran sin tocarlos. */
  ignored: string[]
}

/** UUID estable (formato v5-like) derivado de `legacy:<tenant>:<id viejo>`. */
export function legacyClientId(tenantId: string, legacyId: string): string {
  const h = createHash('sha1').update(`legacy:${tenantId}:${legacyId}`).digest()
  h[6] = (h[6] & 0x0f) | 0x50
  h[8] = (h[8] & 0x3f) | 0x80
  const hex = h.subarray(0, 16).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

export const MAX_LEGACY_ITEMS = 500

export function importLegacyQueue(
  store: OutboxStore,
  tenantId: string,
  items: LegacyQueuedPurchase[],
  sourceUserId: string | null,
  now: Date = new Date(),
): LegacyImportResult {
  const result: LegacyImportResult = { imported: [], rejected: [], ignored: [] }

  for (const raw of items.slice(0, MAX_LEGACY_ITEMS)) {
    const id = typeof raw?.id === 'string' ? raw.id : ''
    if (!id) {
      result.rejected.push({ id: '', reason: 'sin id' })
      continue
    }
    if (raw.tenantId !== tenantId) {
      result.ignored.push(id)
      continue
    }
    try {
      if (raw.payload === null || typeof raw.payload !== 'object' || Array.isArray(raw.payload)) {
        throw new InvalidRequest('payload inválido')
      }
      const { payload } = parseSale(raw.payload as Record<string, unknown>)
      const queuedMs = typeof raw.queuedAt === 'string' ? Date.parse(raw.queuedAt) : NaN
      const createdAt = new Date(Number.isNaN(queuedMs) || queuedMs > now.getTime() ? now.getTime() : queuedMs).toISOString()
      store.enqueue({
        type: 'SALE',
        payload: JSON.stringify(payload),
        createdAt,
        sourceUserId,
        clientId: legacyClientId(tenantId, id),
      })
      result.imported.push(id)
    } catch (err) {
      result.rejected.push({ id, reason: err instanceof InvalidRequest ? err.message : `error: ${(err as Error).message}` })
    }
  }
  if (items.length > MAX_LEGACY_ITEMS) {
    for (const raw of items.slice(MAX_LEGACY_ITEMS)) {
      if (typeof raw?.id === 'string') result.rejected.push({ id: raw.id, reason: 'demasiados ítems en un solo envío' })
    }
  }
  if (result.imported.length > 0) store.setMeta('legacy_imported_at', now.toISOString())
  return result
}
