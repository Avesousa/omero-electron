/**
 * Configuración de runtime del POS (modo de ejecución y backend).
 *
 * Son funciones (no constantes) a propósito: leen `process.env` al llamarse, no al importar,
 * para que `next build` no falle por falta de variables y para poder testearlas con un `env` inyectado.
 * Solo se usan en el servidor (BACKEND_URL nunca debe llegar al navegador).
 */

import path from 'node:path'

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

/** Intervalo del refresco de la caché de catálogo (ms). */
export const DEFAULT_SYNC_INTERVAL_MS = 300_000

/**
 * Directorio de las bases SQLite del catálogo (`OMERO_DATA_DIR`; Electron lo inyecta en desktop).
 * En desarrollo (NODE_ENV distinto de "production") sin definir → `<cwd>/.data`.
 * En producción sin definir → null: no hay caché y todo sigue funcionando por proxy directo.
 */
export function getDataDir(env: Env = process.env): string | null {
  const raw = env.OMERO_DATA_DIR?.trim()
  if (raw) return raw
  return env.NODE_ENV === 'production' ? null : path.join(process.cwd(), '.data')
}

/** Ruta al `.node` de better-sqlite3 a usar (binario de Electron empaquetado), o null para el binding por defecto. */
export function getSqliteBinding(env: Env = process.env): string | null {
  return env.OMERO_SQLITE_BINDING?.trim() || null
}

/** `CATALOG_SYNC_INTERVAL_MS` (opcional). Entero positivo; si es inválido se usa el default (5 min). */
export function getSyncIntervalMs(env: Env = process.env): number {
  const raw = env.CATALOG_SYNC_INTERVAL_MS?.trim()
  if (!raw) return DEFAULT_SYNC_INTERVAL_MS
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_SYNC_INTERVAL_MS
}
