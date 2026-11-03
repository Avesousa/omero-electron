'use client'

import { useEffect, useRef } from 'react'
import { fetchDeviceInfo, reasonFor, renewSession } from '@/lib/deviceSession'
import { getSessionExpiry } from '@/lib/sessionManager'

interface Options {
  /** Solo hay sesión que revisar si el usuario está autenticado. */
  authenticated: boolean
  /** La sesión de la caja terminó (revocada, vencida, exige login): el llamador cierra y va al login con el motivo. */
  onSessionLost: (reason: 'device-revoked' | 'device-expired' | 'login-required') => void
}

/**
 * Sesión de la caja en el POS de escritorio. NO hay renovaciones por reloj: el JWT de caja dura 26 h y la validación de la
 * sesión de 14 días la hace el servidor local de forma pasiva (como mucho 1 vez cada 24 h, al operar). Acá solo se reacciona
 * a eventos:
 *  - al montar y al volver a la pestaña / recuperar la red: si el servidor local ya sabe que la sesión terminó, se corta con
 *    el motivo; si el JWT está vencido, se renueva (renovación OBLIGATORIA: es obtener credencial, no validar).
 * Sin conexión no pasa nada: la caja sigue vendiendo (outbox). En web / sin caja no hace nada.
 */
export function useSessionRenewal({ authenticated, onSessionLost }: Options): void {
  const lost = useRef(onSessionLost)
  lost.current = onSessionLost

  useEffect(() => {
    if (!authenticated) return
    let cancelled = false
    let running = false
    let active = false // hay caja registrada (desktop)

    const jwtExpired = () => {
      const exp = getSessionExpiry()
      return exp !== null && exp * 1000 <= Date.now()
    }

    const check = async () => {
      if (cancelled || running) return
      running = true
      try {
        const info = await fetchDeviceInfo()
        if (cancelled) return
        active = info.desktop && info.hasDevice
        if (!active) return
        const ended = info.endedReason ? reasonFor(info.endedReason) : null
        if (ended) {
          lost.current(ended)
          return
        }
        if (!jwtExpired()) return
        const r = await renewSession() // obligatoria: JWT vencido
        if (cancelled || r.ok) return
        const reason = reasonFor(r.code)
        if (reason) lost.current(reason) // UNAVAILABLE / NO_DEVICE: sin conexión no pasa nada, se reintenta al volver
      } finally {
        running = false
      }
    }

    const onWake = () => {
      if (typeof document !== 'undefined' && document.hidden) return
      void check()
    }

    void check()
    window.addEventListener('online', onWake)
    document.addEventListener('visibilitychange', onWake)
    return () => {
      cancelled = true
      window.removeEventListener('online', onWake)
      document.removeEventListener('visibilitychange', onWake)
    }
  }, [authenticated])
}
