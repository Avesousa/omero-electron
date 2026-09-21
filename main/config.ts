/**
 * URL of the Next.js app to load in the Electron BrowserWindow.
 * In development: point to the local dev server.
 * In production: the local Next standalone server (localhost:3000).
 * Override via OMERO_POS_URL environment variable.
 */
export const POS_URL = process.env.OMERO_POS_URL ?? 'http://localhost:3000/pos'

export interface BuildConfig {
  /** Backend URL embebida en el build del instalador (ver scripts/write-build-config.mjs). */
  defaultBackendUrl?: string
}

/**
 * Valida que sea un ORIGEN http(s) (sin path, query, fragmento ni credenciales) y lo normaliza
 * (sin "/" final). Mismas reglas que `getBackendUrl` en web/src/lib/runtime.ts: si aquí se aceptara
 * algo que el Next rechaza, el error aparecería recién al arrancar el servidor.
 */
function normalizeHttpUrl(raw: string, source: string): string {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new Error(`${source} no es una URL válida: "${raw}"`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${source} debe usar http o https: "${raw}"`)
  }
  if (url.username || url.password) {
    throw new Error(`${source} no debe incluir credenciales`)
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${source} debe ser solo el origen, sin path, query ni fragmento: "${raw}"`)
  }
  return url.origin
}

/**
 * URL del backend de Railway al que el Next local hace de proxy.
 * Prioridad: variable de entorno BACKEND_URL > default embebido en el build.
 * Función pura (no depende de electron) para poder testearla.
 */
export function resolveBackendUrl(
  env: Record<string, string | undefined>,
  buildConfig: BuildConfig | null,
): string {
  const fromEnv = env.BACKEND_URL?.trim()
  if (fromEnv) return normalizeHttpUrl(fromEnv, 'BACKEND_URL')

  const fromBuild = buildConfig?.defaultBackendUrl?.trim()
  if (fromBuild) return normalizeHttpUrl(fromBuild, 'defaultBackendUrl (build-config.json)')

  throw new Error(
    'No hay URL de backend: definí BACKEND_URL o generá resources/build-config.json con OMERO_DEFAULT_BACKEND_URL.',
  )
}
