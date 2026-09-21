/**
 * useSales.ts
 *
 * Handles sale creation with:
 *   - Async retry (3 attempts, 3s/9s/27s backoff) for transient failures
 *   - Offline queue: on retryable failure after all retries, payload is saved to localStorage
 *   - Background flush of pending queue at the start of each sale attempt
 *
 * Fire-and-forget design:
 *   createSale() makes the first attempt synchronously. If it succeeds, the caller
 *   gets a success result immediately. If the first attempt fails with a retryable
 *   error, createSale() returns { success: false, queuing: true } immediately while
 *   the retry loop continues in the background. This keeps the sale UI responsive.
 *
 * Manual test checklists:
 *
 * [US1-T007] Network offline → submit purchase — UI not blocked:
 *   Open DevTools → Network → set to Offline.
 *   Submit a sale from the POS page.
 *   → Payment modal closes immediately (optimistic). After ~39s (3+9+27s retries
 *     complete in background), localStorage['omero_purchase_queue'] contains 1 item
 *     and notification "Compra guardada sin conexión..." appears.
 *     The POS remained fully interactive during the retries.
 *
 * [US1-T008] Server returns 500 → 3 retries:
 *   Intercept /api/sales to return 500.
 *   Submit sale. Observe 3 additional requests in network tab (~3+9+27s apart).
 *   After last retry → queue has 1 item.
 *
 * [US1-T009] Server returns 400 → no queue:
 *   Intercept /api/sales to return 400.
 *   Submit sale. → queue has 0 items; error notification shown immediately.
 *
 * [US3-T022] addToQueue waits for FlushLock:
 *   During a slow flush (bulk endpoint delayed), submit a failing sale.
 *   Inspect localStorage — new item does not appear until flush releases the lock.
 */

import { useState } from 'react'
import type { CartItem } from '../types'
import { addToQueue } from '@/lib/purchaseQueueStorage'
import { apiFetch } from '@/lib/apiClient'
import { getSessionUser } from '@/lib/sessionManager'
import {
  withAsyncRetry,
  isRetryable,
  waitForLockRelease,
  FlushLock,
  NonRetryableHttpError,
  RetryableHttpError,
  type PurchaseRequestPayload
} from './useOfflineQueue'

// Inline id generator — no external dependency required
function generateId(): string {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9)
}

export type SaleResult =
  | { success: true; sale: unknown }
  | { success: false; error: string; queuing?: boolean }

export const useSales = (
  showNotification?: (message: string, type: 'success' | 'error' | 'info' | 'offline_saved') => void,
  flushQueue?: () => Promise<void>,
  refreshCount?: () => void
) => {
  const [isProcessing, setIsProcessing] = useState(false)

  /**
   * Persists the payload to the offline queue after waiting for any flush to finish.
   * Logs and notifies the user. Gracefully handles unavailable localStorage.
   */
  const saveToQueue = async (payload: PurchaseRequestPayload, tenantId: string | undefined): Promise<void> => {
    console.warn('[useSales] Sale failed after all retries — saving to offline queue', {
      queuedAt: new Date().toISOString()
    })

    try {
      // Wait for any in-progress flush to release the lock before writing
      // to avoid concurrent-write issues (US3).
      if (FlushLock.isLocked()) {
        await waitForLockRelease()
      }

      addToQueue({
        id: generateId(),
        payload,
        queuedAt: new Date().toISOString(),
        tenantId
      })

      refreshCount?.()

      showNotification?.(
        'Compra guardada sin conexion. Se sincronizara automaticamente.',
        'offline_saved'
      )
    } catch (storageErr) {
      console.warn('[useSales] Failed to save sale to offline queue:', storageErr)
      showNotification?.(
        'Error al guardar la compra localmente. Verificar almacenamiento del navegador.',
        'error'
      )
    }
  }

  /**
   * Attempts a single fetch to /api/sales.
   * Throws RetryableHttpError, NonRetryableHttpError, or a network error.
   * Returns { success, sale?, error? } on a successful response.
   */
  const attemptFetch = async (payload: PurchaseRequestPayload): Promise<SaleResult> => {
    const result = await apiFetch<unknown>('/api/sales', {
      method: 'POST',
      body: JSON.stringify(payload)
    })

    if (result.success) {
      return { success: true, sale: result.data }
    }
    // API returned success:false — check if retryable based on error message
    const errorMsg = result.error || 'Error al procesar la venta'
    // Treat server errors (5xx-like messages) as retryable, others as non-retryable
    if (errorMsg.includes('500') || errorMsg.toLowerCase().includes('server error')) {
      throw new RetryableHttpError(500, errorMsg)
    }
    throw new NonRetryableHttpError(400, errorMsg)
  }

  const createSale = async (
    items: CartItem[],
    cashAmount: number = 0,
    mpAmount: number = 0,
    change: number = 0
  ): Promise<SaleResult> => {
    setIsProcessing(true)

    // The tenant that captured this sale, fixed now: the retries below can take a minute and the
    // queued sale must stay with this business even if the session changes meanwhile.
    const saleTenantId = getSessionUser()?.tenantId

    // Build the payload once — reused in retries and stored in queue if needed
    // Los items de precio libre (código '000-xxx') se agrupan en un único item al enviarse
    const freePriceItems = items.filter(i => i.code.startsWith('000'))
    const regularItems = items.filter(i => !i.code.startsWith('000'))

    const aggregatedItems = [...regularItems]
    if (freePriceItems.length > 0) {
      const totalFreePriceAmount = freePriceItems.reduce((sum, i) => sum + (i.total || 0), 0)
      aggregatedItems.push({
        ...freePriceItems[0],
        code: '000',
        quantity: freePriceItems.length,
        price: totalFreePriceAmount,
        total: totalFreePriceAmount,
      })
    }

    const saleItems = aggregatedItems.map(item => ({
      productId: item.code,
      quantity: item.quantity,
      unitPrice: item.price,
      total: item.total,
      promotionId: item.promotionId || null,
      promotionName: item.promotionName || null
    }))

    const payload: PurchaseRequestPayload = {
      items: saleItems,
      cashAmount,
      mpAmount,
      change
    }

    // Fire-and-forget: flush pending queue before attempting the new sale.
    // Not awaited — flush runs in background concurrently with the new attempt.
    if (flushQueue) {
      flushQueue().catch(err => {
        console.warn('[useSales] Background flush error (ignored):', err)
      })
    }

    // --- First attempt (synchronous from the caller's perspective) ---
    let firstResult: SaleResult | null = null
    let firstError: unknown = null

    try {
      firstResult = await attemptFetch(payload)
    } catch (err) {
      firstError = err
    }

    // Non-retryable (4xx) on first attempt — return error immediately, no retry
    if (firstError && !isRetryable(firstError)) {
      setIsProcessing(false)
      const message = firstError instanceof Error ? firstError.message : 'Error al procesar la venta'
      return { success: false, error: message }
    }

    // Success on first attempt
    if (firstResult !== null) {
      setIsProcessing(false)
      return firstResult
    }

    // --- Retryable failure on first attempt ---
    // Return immediately so the UI is not blocked, then retry in the background.
    setIsProcessing(false)

    // Background retry loop (fire-and-forget via .then().catch())
    // 3 retries with 3s/9s/27s backoff as specified.
    withAsyncRetry(
      () => attemptFetch(payload),
      3,
      [3000, 9000, 27000]
    )
      .then(result => {
        if (result.success) {
          // Retry succeeded — but we already told the UI it was queued.
          // Show a success notification so the user knows it went through.
          showNotification?.('Venta procesada exitosamente (reintento).', 'success')
          refreshCount?.()
        }
        // result.success === false with 2xx — application-level failure, treat as queued
      })
      .catch(async retryErr => {
        if (isRetryable(retryErr)) {
          await saveToQueue(payload, saleTenantId)
        } else {
          // Non-retryable on retry (shouldn't happen often — means server changed
          // response between first and subsequent calls)
          showNotification?.('Error al procesar la venta.', 'error')
        }
      })

    return {
      success: false,
      error: 'Sin conexion. La venta sera procesada automaticamente cuando haya red.',
      queuing: true
    }
  }

  return {
    createSale,
    isProcessing
  }
}
