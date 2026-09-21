/**
 * useOfflineQueue.ts
 *
 * Exposes:
 *   - flushQueue()     — sends the current tenant's queued sales to POST /api/sales, one at a time
 *   - pendingCount     — live count of items waiting to sync
 *   - withAsyncRetry   — generic async retry utility (re-exported for useSales)
 *   - FlushLock        — module-level singleton preventing concurrent flushes
 *   - isRetryable      — classifies errors as retryable or not
 *
 * Manual test checklists:
 *
 * [US2-T014] 2 items in queue + network restored + new purchase:
 *   Pre-populate localStorage['omero_purchase_queue'] with 2 items.
 *   Restore network. Submit a new purchase.
 *   → Observe 2-item bulk POST in network tab, queue empty after 200.
 *
 * [US2-T015] flush returns 500:
 *   Set DevTools to return 500 on /api/sales/bulk.
 *   Submit purchase. → Queue unchanged; new failing purchase added to queue.
 *
 * [US2-T016] 60 items in queue:
 *   Pre-populate 60 items. Submit purchase.
 *   → Two bulk POSTs observed (50 then 10), queue empty after both succeed.
 *
 * [US3-T020] Race condition — flush in progress:
 *   Slow the bulk endpoint (e.g., with a 30s delay). Submit a failing purchase
 *   during the flush. Observe the new item is not written until the flush finishes
 *   (localStorage snapshots in DevTools).
 *
 * [US3-T021] No second flush while one runs:
 *   Trigger flush; immediately trigger another purchase attempt.
 *   → Only one bulk call in the network tab.
 */

import { useState, useCallback } from 'react'
import {
  loadQueueForTenant,
  removeFromQueue,
  type QueuedPurchase,
  type PurchaseRequestPayload
} from '@/lib/purchaseQueueStorage'
import { apiFetch } from '@/lib/apiClient'
import { getSessionUser } from '@/lib/sessionManager'

// Re-export types so useSales can import from a single hook file
export type { QueuedPurchase, PurchaseRequestPayload }

// ---------------------------------------------------------------------------
// FlushLock — in-memory singleton, resets on page reload (safe by design)
// ---------------------------------------------------------------------------

/**
 * Module-level lock that prevents concurrent flush operations.
 * Not persisted — resets on page reload, which is safe because any
 * in-flight fetch also resets on reload.
 */
export const FlushLock = (() => {
  let locked = false
  return {
    isLocked: () => locked,
    acquire: () => { locked = true },
    release: () => { locked = false }
  }
})()

// ---------------------------------------------------------------------------
// isRetryable — error classifier
// ---------------------------------------------------------------------------

/**
 * Returns true for errors that are worth retrying:
 *   - Network errors (fetch threw, no Response object)
 *   - HTTP 5xx server errors
 * Returns false for HTTP 4xx (validation / bad request — no point retrying).
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof RetryableHttpError) return true
  if (error instanceof NonRetryableHttpError) return false
  // Any other error (TypeError from fetch, network failure) is retryable
  return true
}

/**
 * Thrown by callers when an HTTP response comes back with a status code.
 * Allows isRetryable to inspect the status without parsing the error message.
 */
export class RetryableHttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'RetryableHttpError'
  }
}

export class NonRetryableHttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'NonRetryableHttpError'
  }
}

/**
 * Wraps a fetch Response and throws the appropriate typed error.
 * Call this immediately after fetch() to get a classified error.
 */
export function throwIfHttpError(response: Response): void {
  if (response.ok) return
  if (response.status >= 500) {
    throw new RetryableHttpError(response.status, `HTTP ${response.status}`)
  }
  if (response.status >= 400) {
    throw new NonRetryableHttpError(response.status, `HTTP ${response.status}`)
  }
}

// ---------------------------------------------------------------------------
// withAsyncRetry — generic retry utility
// ---------------------------------------------------------------------------

const DEFAULT_BACKOFF_MS = [3000, 9000, 27000] as const

/**
 * Calls fn() and retries on retryable failures.
 *
 * @param fn          The async operation to attempt.
 * @param retries     Number of retries after the initial attempt (default 3).
 * @param backoffMs   Delays between attempts in milliseconds (default 3s/9s/27s).
 *
 * Throws the last error if all attempts are exhausted.
 * Non-retryable errors (HTTP 4xx) propagate immediately without retrying.
 */
export async function withAsyncRetry<T>(
  fn: () => Promise<T>,
  retries: number = 3,
  backoffMs: readonly number[] = DEFAULT_BACKOFF_MS
): Promise<T> {
  let lastError: unknown
  const totalAttempts = retries + 1

  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err

      // Non-retryable errors propagate immediately
      if (!isRetryable(err)) {
        throw err
      }

      // No more retries — throw
      if (attempt >= totalAttempts - 1) {
        break
      }

      const delay = backoffMs[attempt] ?? backoffMs[backoffMs.length - 1]
      await new Promise<void>(resolve => setTimeout(resolve, delay))
    }
  }

  throw lastError
}

// ---------------------------------------------------------------------------
// waitForLockRelease — helper for addToQueue in useSales
// ---------------------------------------------------------------------------

/**
 * Polls until FlushLock is released, then resolves.
 * Used by useSales before writing to the queue to avoid concurrent-write issues.
 */
export async function waitForLockRelease(pollIntervalMs: number = 200): Promise<void> {
  if (!FlushLock.isLocked()) return
  return new Promise<void>(resolve => {
    const interval = setInterval(() => {
      if (!FlushLock.isLocked()) {
        clearInterval(interval)
        resolve()
      }
    }, pollIntervalMs)
  })
}

// ---------------------------------------------------------------------------
// Bulk flush constants
// ---------------------------------------------------------------------------

const CHUNK_SIZE = 50
// The backend only exposes POST /api/sales (one sale per call); there is no bulk endpoint.
const SALES_ENDPOINT = '/api/sales'

// ---------------------------------------------------------------------------
// useOfflineQueue hook
// ---------------------------------------------------------------------------

/**
 * Manages the offline purchase queue.
 *
 * Returns:
 *   flushQueue()   — fire-and-forget flush; call at the start of each purchase attempt
 *   pendingCount   — number of items currently in the queue
 *   refreshCount   — call after addToQueue/removeFromQueue to update the badge
 */
export const useOfflineQueue = () => {
  const countForCurrentTenant = () => loadQueueForTenant(getSessionUser()?.tenantId).length
  const [pendingCount, setPendingCount] = useState<number>(countForCurrentTenant)

  /**
   * Re-reads the queue length from localStorage and updates React state.
   * Call this after any mutation (addToQueue, removeFromQueue).
   */
  const refreshCount = useCallback(() => {
    setPendingCount(countForCurrentTenant())
  }, [])

  /**
   * Sends each queued sale to POST /api/sales one at a time.
   *
   * Constraints:
   *   - Returns immediately if FlushLock is already held (prevent double-flush).
   *   - Acquires FlushLock before iterating; always releases in finally.
   *   - Re-reads the queue at the start of each iteration (concurrent-tab safety).
   *   - On success: removes that item from the queue and continues.
   *   - On any error (network or server): stops and leaves remaining items intact.
   */
  const flushQueue = useCallback(async (): Promise<void> => {
    if (FlushLock.isLocked()) return

    FlushLock.acquire()

    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        // Only the current session's tenant; re-evaluated every iteration in case the session changed
        const tenantId = getSessionUser()?.tenantId
        const queue = loadQueueForTenant(tenantId)
        if (queue.length === 0) break

        const item = queue[0]

        let result: { success: boolean; error?: string }
        try {
          result = await apiFetch(SALES_ENDPOINT, {
            method: 'POST',
            body: JSON.stringify(item.payload)
          })
        } catch (networkErr) {
          console.warn('[useOfflineQueue] flushQueue failed — network error, queue left unchanged:', networkErr)
          break
        }

        if (result.success) {
          removeFromQueue([item.id])
        } else {
          console.warn('[useOfflineQueue] flushQueue failed — server returned error, queue left unchanged:', result.error)
          break
        }
      }
    } finally {
      FlushLock.release()
      setPendingCount(countForCurrentTenant())
    }
  }, [])

  return {
    flushQueue,
    pendingCount,
    refreshCount
  }
}
