/**
 * useOfflineQueue.ts
 *
 * Migración de la cola VIEJA del POS (`omero_purchase_queue` en localStorage) al nuevo esquema.
 * Desde la fase 3 las ventas y gastos offline viven en el outbox SQLite del servidor local (solo desktop):
 *
 *   desktop → al iniciar se IMPORTA la cola vieja al outbox (`POST /api/_local/outbox/import`, idempotente) y se
 *             borra de localStorage solo lo que el servidor confirmó. Si el outbox no está disponible, se sube directo.
 *   web     → no se encola nada; lo que hubiera quedado de la versión anterior se sube UNA vez y se borra.
 *
 * Un solo flujo a la vez (`FlushLock`). Nunca toca ítems de otro tenant ni sin tenant.
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import { loadQueueForTenant, removeFromQueue, type QueuedPurchase } from '@/lib/purchaseQueueStorage'
import { apiFetch } from '@/lib/apiClient'
import { getSessionUser } from '@/lib/sessionManager'

/** Candado del proceso: evita dos migraciones/subidas simultáneas. Se reinicia al recargar la página. */
export const FlushLock = (() => {
  let locked = false
  return {
    isLocked: () => locked,
    acquire: () => { locked = true },
    release: () => { locked = false },
  }
})()

// El backend solo expone POST /api/sales (una venta por llamada).
const SALES_ENDPOINT = '/api/sales'
const IMPORT_ENDPOINT = '/api/_local/outbox/import'

interface ImportResponse {
  available?: boolean
  imported?: string[]
}

/**
 * Sube la cola vieja directo al backend, una por una, y borra cada una al confirmarse. Se detiene en el primer error
 * (queda intacta para el próximo inicio). Devuelve cuántas subió.
 */
export async function flushLegacyQueue(tenantId: string | undefined): Promise<number> {
  let sent = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const queue = loadQueueForTenant(tenantId)
    if (queue.length === 0) break
    const item = queue[0]
    let result: { success: boolean; error?: string }
    try {
      result = await apiFetch(SALES_ENDPOINT, { method: 'POST', body: JSON.stringify(item.payload) })
    } catch (err) {
      console.warn('[useOfflineQueue] no se pudo subir la cola vieja (red):', err)
      break
    }
    if (!result.success) {
      console.warn('[useOfflineQueue] no se pudo subir la cola vieja (servidor):', result.error)
      break
    }
    removeFromQueue([item.id])
    sent++
  }
  return sent
}

/**
 * Importa la cola vieja al outbox del servidor local y borra de localStorage lo confirmado.
 * Devuelve `imported` (cantidad confirmada) o `null` si el outbox no está disponible (hay que subir directo).
 */
export async function importLegacyQueue(tenantId: string | undefined): Promise<number | null> {
  const items: QueuedPurchase[] = loadQueueForTenant(tenantId)
  if (items.length === 0) return 0
  try {
    const result = await apiFetch<ImportResponse>(IMPORT_ENDPOINT, { method: 'POST', body: JSON.stringify({ items }) })
    if (!result.success || result.data.available === false) return null
    const imported = result.data.imported ?? []
    removeFromQueue(imported)
    return imported.length
  } catch (err) {
    console.warn('[useOfflineQueue] no se pudo importar la cola vieja:', err)
    return 0 // error transitorio: queda en localStorage y se reintenta en el próximo inicio
  }
}

/** Ejecuta la migración según el runtime. Nunca lanza. */
export async function migrateLegacyQueue(runtime: 'web' | 'desktop', tenantId: string | undefined): Promise<void> {
  if (!tenantId || FlushLock.isLocked()) return
  FlushLock.acquire()
  try {
    if (runtime === 'desktop') {
      const imported = await importLegacyQueue(tenantId)
      if (imported === null) await flushLegacyQueue(tenantId) // sin outbox: como en web
    } else {
      await flushLegacyQueue(tenantId)
    }
  } catch (err) {
    console.warn('[useOfflineQueue] migración de la cola vieja falló:', err)
  } finally {
    FlushLock.release()
  }
}

/**
 * Ejecuta la migración una vez por sesión de página cuando el runtime ya se conoce y devuelve cuántos ítems de la
 * cola vieja siguen en localStorage (0 en el caso normal; >0 si aún no se pudieron subir).
 */
export const useOfflineQueue = (runtime: 'web' | 'desktop' | null) => {
  const count = () => loadQueueForTenant(getSessionUser()?.tenantId).length
  const [legacyPending, setLegacyPending] = useState<number>(count)
  const started = useRef(false)

  const refreshCount = useCallback(() => setLegacyPending(count()), [])

  useEffect(() => {
    if (!runtime || started.current) return
    started.current = true
    void migrateLegacyQueue(runtime, getSessionUser()?.tenantId).finally(refreshCount)
  }, [runtime, refreshCount])

  return { legacyPending, refreshCount }
}
