import { getBackendUrl } from '../runtime'

export interface BackendStatus {
  online: boolean
  /** ISO-8601 del chequeo. */
  checkedAt: string
  /** Latencia del chequeo en ms; null si está offline. */
  latencyMs: number | null
}

export interface CheckOptions {
  fetchFn?: typeof fetch
  timeoutMs?: number
  backendUrl?: string
}

/**
 * Verifica la conexión con el backend: `GET {BACKEND_URL}/api/health` con timeout corto.
 * "Online" = el backend respondió 2xx. Un 5xx (p. ej. 502/503/504 del gateway de Railway), un timeout o un
 * error de red = offline. NO envía datos ni dispara sincronizaciones.
 */
export async function checkBackend(options: CheckOptions = {}): Promise<BackendStatus> {
  const { fetchFn = fetch, timeoutMs = 3000 } = options
  const checkedAt = new Date().toISOString()
  const started = Date.now()
  try {
    const backend = options.backendUrl ?? getBackendUrl()
    const res = await fetchFn(`${backend}/api/health`, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    })
    await res.body?.cancel().catch(() => {})
    return res.ok
      ? { online: true, checkedAt, latencyMs: Date.now() - started }
      : { online: false, checkedAt, latencyMs: null }
  } catch {
    return { online: false, checkedAt, latencyMs: null }
  }
}
