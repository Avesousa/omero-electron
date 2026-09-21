import { useState, useEffect } from 'react'
import type { NotificationType, PaymentNotification, MPStatusEvent } from '../types'

interface UseMercadoPagoEventsParams {
  showNotification: (message: string, type?: NotificationType) => void
}

export const useMercadoPagoEvents = ({ showNotification }: UseMercadoPagoEventsParams) => {
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
    const backendUrl = process.env.NEXT_PUBLIC_API_URL ?? ''
    const source = new EventSource(`${backendUrl}/api/mercadopago/events`)

    source.onopen = () => {
      setSseConnected(true)
    }

    source.onerror = () => {
      setSseConnected(false)
    }

    source.addEventListener('status', (event: MessageEvent) => {
      try {
        const data: MPStatusEvent = JSON.parse(event.data)
        setMpConnected(data.connected)
      } catch {
        // malformed event — ignore
      }
    })

    source.addEventListener('payment', (event: MessageEvent) => {
      try {
        const payment: PaymentNotification = JSON.parse(event.data)
        setLastPayment(payment)
        setLastPaymentTime(Date.now())
      } catch {
        // malformed event — ignore
      }
    })

    return () => {
      source.close()
    }
  }, [showNotification])

  return {
    isConnected: sseConnected && mpConnected,
    sseConnected,
    mpConnected,
    lastPayment,
    lastPaymentTime,
    clearLastPayment: () => setLastPayment(null)
  }
}
