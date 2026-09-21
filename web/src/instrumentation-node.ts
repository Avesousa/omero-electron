import { getBackendUrl, getRuntime } from '@/lib/runtime'

/**
 * Se ejecuta UNA vez al arrancar el servidor (no en `next build`).
 *
 * 1. Valida el entorno: si falta/es inválida OMERO_RUNTIME o BACKEND_URL el error se propaga y el
 *    servidor no arranca ("falla de forma visible", no silenciosa).
 * 2. Loguea modo y ORIGEN del backend (sin secretos).
 * 3. Mantiene el logging a Better Stack heredado de `omero` (opcional, por BETTERSTACK_TOKEN).
 */

// Next NO termina el proceso cuando falla el hook de instrumentation (loguea y sigue vivo, sirviendo
// errores). Se sale explícitamente con código 1 para que Railway reinicie/marque el deploy como fallido
// y para que Electron detecte el fallo en vez de esperar el timeout.
function validateEnv() {
  try {
    return { runtime: getRuntime(), backend: getBackendUrl() }
  } catch (err) {
    console.error(`[omero-pos] Configuración inválida: ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  }
}

const { runtime, backend } = validateEnv()
console.log(`[omero-pos] runtime=${runtime} backend=${backend}`)

async function log(token: string, message: string): Promise<void> {
  try {
    await fetch('https://in.logs.betterstack.com', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify([{
        dt: new Date().toISOString(),
        level: 'info',
        source: 'frontend',
        message,
      }]),
    })
  } catch {
    // ignore — never let logging break the app
  }
}

const token = process.env.BETTERSTACK_TOKEN
if (token) {
  void log(token, `frontend process started (runtime=${runtime})`)

  const shutdown = async (signal: string) => {
    await log(token, `frontend process stopped (${signal})`)
    process.exit(0)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}
