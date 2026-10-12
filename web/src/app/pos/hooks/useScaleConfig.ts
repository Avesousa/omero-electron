import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/apiClient'
import { DEFAULT_SCALE_CONFIG, SCALE_CONFIG_KEYS, scaleConfigFromEntries, type ScaleConfig, type ScaleConfigKey } from '@/lib/scale'

/**
 * Configuración de balanza del negocio (claves `scale_*`): si el POS interpreta etiquetas y con qué formato.
 * Cada clave se lee por separado (`GET /api/business/config/{key}`) porque así el servidor local del POS de
 * escritorio las sirve desde su caché SQLite cuando no hay conexión, igual que `mp_offline`.
 *
 * Mientras no responde, o si falla, se conserva lo último conocido; si nunca hubo, la balanza queda apagada
 * (un código de 13 dígitos se busca como un código de barras común).
 */

interface ConfigEntry {
  key: string
  value: string | null
}

const REFRESH_MS = 5 * 60_000

export function useScaleConfig(options: { refreshKey?: unknown } = {}): ScaleConfig {
  const { refreshKey } = options
  const [config, setConfig] = useState<ScaleConfig>(DEFAULT_SCALE_CONFIG)
  const known = useRef<Partial<Record<ScaleConfigKey, string | null>>>({})
  const mounted = useRef(true)

  const load = useCallback(async () => {
    await Promise.all(SCALE_CONFIG_KEYS.map(async key => {
      try {
        const result = await apiFetch<ConfigEntry>(`/api/business/config/${encodeURIComponent(key)}`)
        if (result.success) known.current[key] = result.data?.value ?? null
      } catch {
        /* se conserva el último valor de esa clave */
      }
    }))
    // Sin `scale_enabled` conocido no se enciende nada: es la clave que decide si se interpretan etiquetas.
    if (mounted.current && known.current.scale_enabled !== undefined) {
      setConfig(scaleConfigFromEntries(known.current))
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    void load()
    const timer = setInterval(() => void load(), REFRESH_MS)
    return () => {
      mounted.current = false
      clearInterval(timer)
    }
    // refreshKey (p. ej. online) fuerza una relectura cuando cambia la conexión
  }, [load, refreshKey])

  return config
}
