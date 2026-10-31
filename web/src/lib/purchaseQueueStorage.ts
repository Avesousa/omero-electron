/**
 * purchaseQueueStorage.ts
 *
 * Pure localStorage functions for the offline purchase queue.
 * Operates on a single key: omero_purchase_queue.
 *
 * Manual test checklist (browser console):
 *   1. Call addToQueue({ id: 'test-1', payload: {...}, queuedAt: new Date().toISOString() })
 *      → loadQueue() returns array with 1 item
 *   2. Call addToQueue with another item → loadQueue() returns 2 items
 *   3. Call removeFromQueue(['test-1']) → loadQueue() returns 1 item
 *   4. Simulate localStorage unavailable (mock) → addToQueue does not throw, logs warning
 */

// Re-exported from here so consumers import a single module
export type { QueuedPurchase, PurchaseRequestPayload }

/**
 * The payload shape that matches what useSales sends to /api/sales.
 */
interface PurchaseRequestPayload {
  items: Array<{
    productId: string
    quantity: number
    unitPrice: number
    total: number
    promotionId: string | null
    promotionName: string | null
  }>
  cashAmount: number
  mpAmount: number
  change: number
}

/**
 * A purchase that has been saved to the offline queue pending sync.
 */
interface QueuedPurchase {
  id: string          // uuid
  payload: PurchaseRequestPayload
  queuedAt: string    // ISO date string
  /**
   * Tenant that captured the sale. The queue lives in the browser and outlives the session, so a
   * later login (possibly another business) must never flush it. Items without it (queued before
   * multi-tenancy) are left untouched rather than guessed.
   */
  tenantId?: string
}

const QUEUE_KEY = 'omero_purchase_queue'

/**
 * Reads and parses the queue from localStorage.
 * Returns an empty array if localStorage is unavailable or the value is malformed.
 */
export function loadQueue(): QueuedPurchase[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed as QueuedPurchase[]
  } catch {
    return []
  }
}

/**
 * The queue items that belong to the given tenant. Fails closed: no tenant, no items.
 * Use this (never loadQueue) to decide what to show or send.
 */
export function loadQueueForTenant(tenantId: string | null | undefined): QueuedPurchase[] {
  if (!tenantId) return []
  return loadQueue().filter(item => item.tenantId === tenantId)
}

/**
 * Overwrites the entire queue in localStorage.
 * Throws if localStorage is unavailable (caller should catch).
 */
export function saveQueue(items: QueuedPurchase[]): void {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(items))
}

/**
 * Appends a single item to the persisted queue.
 * Throws if localStorage is unavailable — callers must handle this.
 */
export function addToQueue(item: QueuedPurchase): void {
  const current = loadQueue()
  current.push(item)
  saveQueue(current)
}

/**
 * Removes items matching the given ids from the queue.
 * Safe to call with ids that are no longer in the queue.
 */
export function removeFromQueue(ids: string[]): void {
  try {
    const idSet = new Set(ids)
    const current = loadQueue()
    const updated = current.filter(item => !idSet.has(item.id))
    saveQueue(updated)
  } catch {
    // If localStorage is unavailable at this point we cannot clean up,
    // but we should not throw — the flush already succeeded on the server.
    console.warn('[purchaseQueueStorage] removeFromQueue failed — localStorage unavailable')
  }
}
