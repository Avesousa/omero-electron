import { useCallback, useEffect, useRef } from 'react'

/** Agrupa ráfagas de eventos `stock` (varias ventas seguidas) en una sola sincronización. */
export const STOCK_DEBOUNCE_MS = 250
/** Respaldo por polling cuando el SSE no está conectado. */
export const STOCK_FALLBACK_POLL_MS = 30_000

interface UseStockSyncParams {
  /** El SSE está abierto (los eventos `stock` llegan solos). */
  sseConnected: boolean
  /** `useProducts().syncStock`: pide el delta y lo aplica. */
  syncStock: () => Promise<void>
}

/**
 * Dispara `syncStock` cuando corresponde:
 *  - `requestSync()` (lo llama el evento SSE `stock`): debounce de 250 ms. El evento es solo un disparador.
 *  - sin SSE: cada 30 s (respaldo; con SSE abierto no hay polling).
 *  - al REABRIRSE el SSE tras una caída: una sincronización (puede haberse perdido algún evento).
 *    La primera apertura no sincroniza: el catálogo recién se cargó.
 */
export function useStockSync({ sseConnected, syncStock }: UseStockSyncParams): { requestSync: () => void } {
  // `syncStock` cambia de identidad en cada render: siempre se llama a la última.
  const syncRef = useRef(syncStock)
  syncRef.current = syncStock
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const everOpened = useRef(false)

  const requestSync = useCallback(() => {
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => {
      debounce.current = null
      void syncRef.current()
    }, STOCK_DEBOUNCE_MS)
  }, [])

  useEffect(() => () => {
    if (debounce.current) clearTimeout(debounce.current)
  }, [])

  useEffect(() => {
    if (sseConnected) {
      if (everOpened.current) requestSync()
      everOpened.current = true
      return
    }
    const timer = setInterval(() => void syncRef.current(), STOCK_FALLBACK_POLL_MS)
    return () => clearInterval(timer)
  }, [sseConnected, requestSync])

  return { requestSync }
}
