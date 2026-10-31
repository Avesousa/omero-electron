import { authHeaders } from '@/lib/sessionManager'
import { useCallback, useEffect, useRef } from 'react'

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL ?? ''
const POLLING_DELAY_MS = 2000

interface UseMercadoPagoPollingParams {
  sseConnected: boolean
  mpConnected: boolean
  lastPaymentTime: number | null
}

export const useMercadoPagoPolling = ({
  sseConnected,
  mpConnected,
  lastPaymentTime,
}: UseMercadoPagoPollingParams) => {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastPaymentTimeRef = useRef<number | null>(lastPaymentTime)

  // Keep ref in sync with prop so the setTimeout closure reads the latest value
  useEffect(() => {
    lastPaymentTimeRef.current = lastPaymentTime
  }, [lastPaymentTime])

  const triggerPollingIfNeeded = useCallback((mpAmountInSale: number) => {
    // Only trigger if there was an MP amount in the sale and the connection is active
    if (mpAmountInSale <= 0 || !sseConnected || !mpConnected) return

    // Capture the timestamp at which the sale was confirmed
    const saleConfirmedAt = Date.now()

    // Cancel any previous pending timer (e.g. two rapid sales)
    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }

    timerRef.current = setTimeout(async () => {
      timerRef.current = null

      // If a payment SSE arrived AFTER this sale was confirmed, skip polling
      const currentLastPaymentTime = lastPaymentTimeRef.current
      if (currentLastPaymentTime !== null && currentLastPaymentTime >= saleConfirmedAt) {
        return
      }

      try {
        await fetch(`${BACKEND_URL}/api/mercadopago/polling/start`, { method: 'POST', headers: authHeaders() })
      } catch {
        // Silent — polling is best-effort
      }
    }, POLLING_DELAY_MS)
  }, [sseConnected, mpConnected])

  return { triggerPollingIfNeeded }
}
