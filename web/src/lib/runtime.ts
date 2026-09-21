/**
 * Configuración de runtime del POS (modo de ejecución y backend).
 *
 * Son funciones (no constantes) a propósito: leen `process.env` al llamarse, no al importar,
 * para que `next build` no falle por falta de variables y para poder testearlas con un `env` inyectado.
 * Solo se usan en el servidor (BACKEND_URL nunca debe llegar al navegador).
 */

export type Runtime = 'web' | 'desktop'

type Env = Record<string, string | undefined>

const RUNTIMES: readonly Runtime[] = ['web', 'desktop']

/** Tiempo máximo hasta recibir los headers del backend (ms). */
export const DEFAULT_PROXY_TIMEOUT_MS = 30_000

/** `OMERO_RUNTIME` = "web" | "desktop". Lanza si falta o es inválido: no se asume un modo. */
export function getRuntime(env: Env = process.env): Runtime {
  const raw = env.OMERO_RUNTIME?.trim()
  if (!raw) {
    throw new Error('OMERO_RUNTIME no está definida. Usá "web" o "desktop".')
  }
  if (!(RUNTIMES as readonly string[]).includes(raw)) {
    throw new Error(`OMERO_RUNTIME inválida: "${raw}". Usá "web" o "desktop".`)
  }
  return raw as Runtime
}

/**
 * `BACKEND_URL`: origen (http/https) del omero-backend. Se devuelve normalizado (sin "/" final).
 * Debe ser solo un origen: sin path, query ni credenciales (el proxy siempre reenvía `/api/*`).
 */
export function getBackendUrl(env: Env = process.env): string {
  const raw = env.BACKEND_URL?.trim()
  if (!raw) {
    throw new Error('BACKEND_URL no está definida (URL del omero-backend, ej. https://backend.example.com).')
  }

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`BACKEND_URL no es una URL válida: "${raw}".`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`BACKEND_URL debe usar http o https: "${raw}".`)
  }
  if (url.username || url.password) {
    throw new Error('BACKEND_URL no debe incluir credenciales.')
  }
  if ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) {
    throw new Error(`BACKEND_URL debe ser solo el origen, sin path, query ni fragmento: "${raw}".`)
  }
  return url.origin
}

/** `PROXY_TIMEOUT_MS` (opcional). Entero positivo; si es inválido se usa el default. */
export function getProxyTimeoutMs(env: Env = process.env): number {
  const raw = env.PROXY_TIMEOUT_MS?.trim()
  if (!raw) return DEFAULT_PROXY_TIMEOUT_MS
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_PROXY_TIMEOUT_MS
}
