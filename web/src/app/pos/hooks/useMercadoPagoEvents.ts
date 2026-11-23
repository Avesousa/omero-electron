import { useState, useEffect, useRef } from 'react'
import { apiFetch } from '@/lib/apiClient'
import { startMpEvents, type TicketResult } from '@/lib/mpEvents'
import type { NotificationType, PaymentNotification, MPStatusEvent } from '../types'

interface UseMercadoPagoEventsParams {
  showNotification: (message: string, type?: NotificationType) => void
  /** Evento `stock` del negocio: solo un disparador para sincronizar el stock (el payload no se usa). */
  onStock?: () => void
}

async function fetchTicket(): Promise<TicketResult> {
  const res = await apiFetch<{ ticket: string; expiresInSeconds: number }>('/api/mercadopago/events/ticket', {
    method: 'POST',
  })
  if (res.success && res.data?.ticket) return { ok: true, ticket: res.data.ticket }
  const error = res.success ? '' : res.error
  return { ok: false, forbidden: error === 'Error 403' }
}

export const useMercadoPagoEvents = ({ showNotification, onStock }: UseMercadoPagoEventsParams) => {
  // La conexión es única por montaje: el callback se lee por ref para no reabrir el stream si cambia.
  const onStockRef = useRef(onStock)
  onStockRef.current = onStock
  const [sseConnected, setSseConnected] = useState(false)
  const [mpConnected, setMpConnected] = useState(false)
  const [lastPayment, setLastPayment] = useState<PaymentNotification | null>(null)
  const [lastPaymentTime, setLastPaymentTime] = useState<number | null>(null)

  useEffect(() => {
    if (!lastPayment) return
    const timer = setTimeout(() => setLastPayment(null), 10000)
    return () => clearTimeout(timer)
  }, [lastPayment])

  useEffect(() => {
    const stop = startMpEvents({
      backendUrl: process.env.NEXT_PUBLIC_API_URL ?? '',
      fetchTicket,
      onOpen: () => setSseConnected(true),
      onClose: () => setSseConnected(false),
      onStatus: (data) => setMpConnected((data as MPStatusEvent).connected),
      onPayment: (data) => {
        setLastPayment(data as PaymentNotification)
        setLastPaymentTime(Date.now())
      },
      onStock: () => onStockRef.current?.(),
    })
    return stop
    // Una sola conexión por montaje: re-ejecutar este efecto abre otro stream y deja el anterior colgado en el server
  }, [])

  return {
    isConnected: sseConnected && mpConnected,
    sseConnected,
    mpConnected,
    lastPayment,
    lastPaymentTime,
    clearLastPayment: () => setLastPayment(null)
  }
}
