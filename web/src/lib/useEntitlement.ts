'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { authHeaders } from '@/lib/sessionManager'
import { isAccessBlocked, parseEntitlement, type Entitlement } from '@/lib/entitlement/rule'
import { clearSubscriptionInactive, useSubscriptionMarkedInactive } from '@/lib/subscriptionGate'

/** Refresco normal del entitlement. */
export const ENTITLEMENT_REFRESH_MS = 5 * 60_000
/** Mientras el POS está bloqueado se consulta seguido para desbloquear solo apenas vuelva el acceso. */
export const ENTITLEMENT_BLOCKED_REFRESH_MS = 30_000
/** Cada cuánto se re-evalúa la regla con la hora actual (para cortar la venta apenas pasa `accessUntil`, incluso offline). */
const CLOCK_TICK_MS = 30_000

export interface EntitlementFetch {
  entitlement: Entitlement
  /** ISO del momento en que el backend lo informó (la hora del caché si se sirvió sin conexión). */
  fetchedAt: string
  /** true = vino de la caché local (sin conexión con el backend). */
  fromCache: boolean
}

/** Consulta `GET /api/billing/entitlement` (en desktop el Next local lo cachea en disco). null si falla o no hay dato. */
export async function fetchEntitlement(fetchFn: typeof fetch = fetch): Promise<EntitlementFetch | null> {
  try {
    const res = await fetchFn('/api/billing/entitlement', { headers: authHeaders(), cache: 'no-store' })
    if (!res.ok) return null
    const entitlement = parseEntitlement(((await res.json()) as { data?: unknown } | null)?.data)
    if (!entitlement) return null
    const fromCache = res.headers.get('X-Omero-Cache') === 'hit'
    const fetchedAt = (fromCache && res.headers.get('X-Omero-Cache-At')) || new Date().toISOString()
    return { entitlement, fetchedAt, fromCache }
  } catch {
    return null
  }
}

export interface UseEntitlementResult {
  entitlement: Entitlement | null
  fetchedAt: string | null
  /** El POS no puede vender: la regla de bloqueo lo indica o el backend respondió 403 SUBSCRIPTION_INACTIVE. */
  blocked: boolean
  refresh: () => Promise<void>
}

/**
 * Mantiene al día el entitlement: al montar, al volver la conexión / la pestaña y cada 5 min (cada 30 s si está
 * bloqueado). Se desbloquea solo cuando una consulta EN VIVO (no de caché) confirma que hay acceso.
 */
export function useEntitlement({ authenticated }: { authenticated: boolean }): UseEntitlementResult {
  const [data, setData] = useState<EntitlementFetch | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const markedInactive = useSubscriptionMarkedInactive()
  const cancelled = useRef(false)

  const refresh = useCallback(async () => {
    if (!authenticated) return
    const result = await fetchEntitlement()
    if (cancelled.current || !result) return
    setData(result)
    setNow(Date.now())
    // Volvió el acceso (dato en vivo): se baja la compuerta del 403.
    if (!result.fromCache && !isAccessBlocked(result.entitlement, Date.now())) clearSubscriptionInactive()
  }, [authenticated])

  const blocked = markedInactive || isAccessBlocked(data?.entitlement, now)

  useEffect(() => {
    cancelled.current = false
    if (!authenticated) return
    void refresh()
    const onWake = () => {
      if (document.visibilityState !== 'hidden') void refresh()
    }
    window.addEventListener('online', onWake)
    document.addEventListener('visibilitychange', onWake)
    const tick = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS)
    return () => {
      cancelled.current = true
      window.removeEventListener('online', onWake)
      document.removeEventListener('visibilitychange', onWake)
      clearInterval(tick)
    }
  }, [authenticated, refresh])

  useEffect(() => {
    if (!authenticated) return
    const timer = setInterval(() => void refresh(), blocked ? ENTITLEMENT_BLOCKED_REFRESH_MS : ENTITLEMENT_REFRESH_MS)
    return () => clearInterval(timer)
  }, [authenticated, blocked, refresh])

  return { entitlement: data?.entitlement ?? null, fetchedAt: data?.fetchedAt ?? null, blocked, refresh }
}
