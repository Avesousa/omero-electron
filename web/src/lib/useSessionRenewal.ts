'use client'

import { useEffect, useRef } from 'react'
import { fetchDeviceInfo, reasonFor, renewSession, type RenewCode } from '@/lib/deviceSession'
import { getSessionExpiry } from '@/lib/sessionManager'

/** Se renueva 5 min antes de que venza el JWT de 1 h. */
export const RENEW_BEFORE_MS = 5 * 60_000
/** Reintento cuando el servidor local no pudo renovar (sin red). */
export const RETRY_MS = 60_000
const MIN_DELAY_MS = 5_000

interface Options {
  /** Solo hay sesión que renovar si el usuario está autenticado. */
  authenticated: boolean
  /** La sesión no se puede renovar (revocada, vencida, exige login): el llamador cierra y va al login con el motivo. */
  onSessionLost: (reason: 'device-revoked' | 'device-expired' | 'login-required') => void
}

/**
 * Renovación silenciosa del JWT en el POS de escritorio con caja registrada (fase 4): agenda `exp − 5 min`, y también
 * renueva al recuperar la red o volver a la pestaña si ya está por vencer. En web / sin caja no hace nada.
 */
export function useSessionRenewal({ authenticated, onSessionLost }: Options): void {
  const lost = useRef(onSessionLost)
  lost.current = onSessionLost

  useEffect(() => {
    if (!authenticated) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let running = false

    const remainingMs = () => {
      const exp = getSessionExpiry()
      return exp === null ? null : exp * 1000 - Date.now()
    }

    const schedule = (delay: number) => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void renew(), Math.max(delay, MIN_DELAY_MS))
    }

    const renew = async () => {
      if (cancelled || running) return
      running = true
      try {
        const r = await renewSession()
        if (cancelled) return
        if (r.ok) {
          const left = remainingMs()
          schedule(left === null ? RETRY_MS : left - RENEW_BEFORE_MS)
          return
        }
        const reason = reasonFor(r.code as RenewCode)
        if (reason) lost.current(reason)
        else schedule(RETRY_MS) // UNAVAILABLE / NO_DEVICE transitorio: se reintenta
      } finally {
        running = false
      }
    }

    const soonOrExpired = () => {
      const left = remainingMs()
      return left !== null && left <= RENEW_BEFORE_MS
    }
    const onWake = () => {
      if (typeof document !== 'undefined' && document.hidden) return
      if (soonOrExpired()) void renew()
    }

    void (async () => {
      const info = await fetchDeviceInfo()
      if (cancelled || !info.desktop || !info.hasDevice) return // web o sin caja: nada que renovar
      const left = remainingMs()
      if (left === null) return
      if (left <= RENEW_BEFORE_MS) void renew()
      else schedule(left - RENEW_BEFORE_MS)
      window.addEventListener('online', onWake)
      document.addEventListener('visibilitychange', onWake)
    })()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      window.removeEventListener('online', onWake)
      document.removeEventListener('visibilitychange', onWake)
    }
  }, [authenticated])
}
