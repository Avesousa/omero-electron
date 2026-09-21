import { useCallback, useEffect, useRef, useState } from 'react'
import { authHeaders } from '@/lib/sessionManager'

/**
 * Estado de la conexión con el backend, según el endpoint local `/api/_local/connectivity` del Next.
 * Solo VERIFICA la conexión (nunca sincroniza ni envía datos). El aviso del POS lo usa en desktop.
 */

export interface CacheInfo {
  lastSyncAt: string | null
  ageSeconds: number | null
  products: number
  promotions: number
}

export interface ConnectivityInfo {
  online: boolean
  checkedAt: string
  latencyMs: number | null
  runtime: 'web' | 'desktop'
  cache: CacheInfo | null
}

export interface ConnectionStatusState {
  /** null hasta la primera respuesta (evita parpadeos del header). */
  runtime: 'web' | 'desktop' | null
  online: boolean
  cache: CacheInfo | null
  checking: boolean
  lastCheckedAt: string | null
  check: () => Promise<void>
}

const POLL_MS = 30_000
const CHECK_TIMEOUT_MS = 8_000

export function useConnectionStatus(pollMs: number = POLL_MS): ConnectionStatusState {
  const [info, setInfo] = useState<ConnectivityInfo | null>(null)
  const [checking, setChecking] = useState(false)
  const inFlight = useRef(false)
  const mounted = useRef(true)

  const check = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    setChecking(true)
    // AbortController + setTimeout (no AbortSignal.timeout): funciona en navegadores viejos del modo web.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS)
    try {
      const res = await fetch('/api/_local/connectivity', {
        headers: authHeaders(),
        cache: 'no-store',
        signal: controller.signal,
      })
      const data = (await res.json()) as ConnectivityInfo
      if (mounted.current) setInfo(data)
    } catch {
      // El propio servidor local no respondió: se considera sin conexión. Sin dato previo se asume web
      // (el aviso es solo de desktop) para no dejar el header en un estado indefinido.
      if (mounted.current) {
        setInfo((prev) => ({
          online: false,
          checkedAt: new Date().toISOString(),
          latencyMs: null,
          runtime: prev?.runtime ?? 'web',
          cache: prev?.cache ?? null,
        }))
      }
    } finally {
      clearTimeout(timer)
      inFlight.current = false
      if (mounted.current) setChecking(false)
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    void check()
    const timer = setInterval(() => {
      if (typeof document === 'undefined' || !document.hidden) void check()
    }, pollMs)
    const onNetworkChange = () => void check()
    window.addEventListener('online', onNetworkChange)
    window.addEventListener('offline', onNetworkChange)
    return () => {
      mounted.current = false
      clearInterval(timer)
      window.removeEventListener('online', onNetworkChange)
      window.removeEventListener('offline', onNetworkChange)
    }
  }, [check, pollMs])

  return {
    runtime: info?.runtime ?? null,
    online: info?.online ?? true,
    cache: info?.cache ?? null,
    checking,
    lastCheckedAt: info?.checkedAt ?? null,
    check,
  }
}
