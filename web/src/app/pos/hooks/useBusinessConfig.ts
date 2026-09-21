import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/apiClient'

/**
 * Lee una clave booleana de la configuración del negocio (`GET /api/business/config/{key}`).
 * En desktop sin conexión el servidor local la sirve desde su caché SQLite (se refresca con el catálogo), así que
 * el valor sigue disponible. Ante cualquier error se conserva el último valor conocido y, si nunca hubo, `false`
 * (lo más restrictivo: p. ej. `mp_offline` apagado = no se puede cobrar con MercadoPago sin conexión).
 */

interface ConfigEntry {
  key: string
  value: string | null
}

const REFRESH_MS = 5 * 60_000

export function isTruthyConfig(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().toLowerCase() === 'true'
}

export function useBusinessFlag(key: string, options: { enabled?: boolean; refreshKey?: unknown } = {}): boolean {
  const { enabled = true, refreshKey } = options
  const [value, setValue] = useState(false)
  const mounted = useRef(true)

  const load = useCallback(async () => {
    try {
      const result = await apiFetch<ConfigEntry>(`/api/business/config/${encodeURIComponent(key)}`)
      if (mounted.current && result.success) setValue(isTruthyConfig(result.data?.value))
    } catch {
      /* se conserva el último valor */
    }
  }, [key])

  useEffect(() => {
    mounted.current = true
    if (!enabled) return
    void load()
    const timer = setInterval(() => void load(), REFRESH_MS)
    return () => {
      mounted.current = false
      clearInterval(timer)
    }
    // refreshKey (p. ej. online) fuerza una relectura cuando cambia la conexión
  }, [enabled, load, refreshKey])

  return value
}
