import { useCallback, useEffect, useRef, useState } from 'react'
import { authHeaders } from '@/lib/sessionManager'

/**
 * Estado del outbox de ventas/gastos del POS desktop, desde `/api/_local/outbox`. Solo LEE (y descarta avisos):
 * el envío al backend lo hace el servidor local en segundo plano. En web queda inactivo (todo en cero).
 */

export type OutboxItemStatus = 'PENDING' | 'SENT' | 'REVIEW' | 'FAILED'

export interface OutboxItemView {
  clientId: string
  type: 'SALE' | 'EXPENSE'
  status: OutboxItemStatus
  createdAt: string
  attempts: number
  lastAttemptAt: string | null
  sentAt: string | null
  error: string | null
  dismissed: boolean
  /** Solo REVIEW: qué marcó el backend. */
  review: { status?: string; reasons?: string[]; items?: { productCode: string; problem: string }[] } | null
  summary: { total?: number; itemCount?: number; products?: string[]; description?: string; amount?: number }
}

export interface OutboxCountsView {
  pending: number
  sent: number
  review: number
  failed: number
}

/** Por qué el envío está detenido (además de "sin conexión"). */
export type SyncBlock = 'unauthorized' | 'unsupported' | null

export interface OutboxStatusState {
  available: boolean
  counts: OutboxCountsView
  /** Estado del envío según el servidor local: ok | offline | unsupported | unauthorized. */
  backend: 'ok' | 'offline' | 'unsupported' | 'unauthorized'
  nextAttemptAt: string | null
  items: OutboxItemView[]
  refresh: () => Promise<void>
  dismiss: (clientId: string) => Promise<boolean>
}

const ZERO: OutboxCountsView = { pending: 0, sent: 0, review: 0, failed: 0 }
/** Con envíos en curso se consulta seguido (la venta recién hecha debe verse ya); en reposo, poco. */
export const POLL_ACTIVE_MS = 5_000
export const POLL_IDLE_MS = 20_000

export function useOutboxStatus(runtime: 'web' | 'desktop' | null): OutboxStatusState {
  const [data, setData] = useState<Omit<OutboxStatusState, 'refresh' | 'dismiss'>>({
    available: false,
    counts: ZERO,
    backend: 'ok',
    nextAttemptAt: null,
    items: [],
  })
  const mounted = useRef(true)
  const inFlight = useRef(false)
  const pendingRef = useRef(0)
  const active = runtime === 'desktop'

  const refresh = useCallback(async () => {
    if (!active || inFlight.current) return
    inFlight.current = true
    try {
      const res = await fetch('/api/_local/outbox?limit=100', { headers: authHeaders(), cache: 'no-store' })
      const body = (await res.json()) as { success?: boolean; data?: Omit<OutboxStatusState, 'refresh' | 'dismiss'> }
      if (mounted.current && body?.success && body.data) {
        pendingRef.current = body.data.counts.pending
        setData(body.data)
      }
    } catch {
      /* el servidor local no respondió: se conserva lo último conocido */
    } finally {
      inFlight.current = false
    }
  }, [active])

  const dismiss = useCallback(
    async (clientId: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/_local/outbox/${encodeURIComponent(clientId)}/dismiss`, {
          method: 'POST',
          headers: authHeaders(),
        })
        await refresh()
        return res.ok
      } catch {
        return false
      }
    },
    [refresh],
  )

  useEffect(() => {
    mounted.current = true
    if (!active) return
    let timer: ReturnType<typeof setTimeout>
    const schedule = () => {
      if (!mounted.current) return
      timer = setTimeout(async () => {
        if (typeof document === 'undefined' || !document.hidden) await refresh()
        schedule()
      }, pendingRef.current > 0 ? POLL_ACTIVE_MS : POLL_IDLE_MS)
    }
    // El primer sondeo decide el ritmo (con pendientes se consulta seguido desde el principio).
    void refresh().finally(schedule)
    const onNetwork = () => void refresh()
    window.addEventListener('online', onNetwork)
    return () => {
      mounted.current = false
      clearTimeout(timer)
      window.removeEventListener('online', onNetwork)
    }
  }, [active, refresh])

  return { ...data, refresh, dismiss }
}
