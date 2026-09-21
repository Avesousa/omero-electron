import { proxyToBackend } from './backend-proxy'
import { proxyWithCatalog } from './catalog/catalog-proxy'
import { getRuntime } from './runtime'
import { handleOutboxRequest, matchOutboxRoute } from './outbox/outbox-proxy'

/**
 * Capa de datos de `/api/*`. Único punto de entrada del route handler catch-all.
 *
 *   web     → proxy directo al backend (sin caché ni SQLite; el módulo nativo NUNCA se carga)
 *   desktop → lecturas de catálogo con SQLite (`catalog-proxy`); `POST /api/sales` y `POST /api/expenses` al outbox
 *             SQLite (`outbox-proxy`, se suben en segundo plano); el resto, proxy directo
 *
 * Punto de extensión: cualquier nueva ruta con comportamiento offline se agrega acá, sin tocar el route handler ni
 * el proxy. Si el outbox no está disponible la request sigue por el camino anterior (degradación sin error).
 */
export async function handleApiRequest(request: Request): Promise<Response> {
  let runtime: string
  try {
    runtime = getRuntime()
  } catch {
    // instrumentation ya valida el entorno al arrancar; si igual falta, se comporta como web
    return proxyToBackend(request)
  }
  if (runtime !== 'desktop') return proxyToBackend(request)

  const outboxType = matchOutboxRoute(request.method, new URL(request.url).pathname)
  if (outboxType) {
    const queued = await handleOutboxRequest(request, outboxType)
    if (queued) return queued
  }
  return proxyWithCatalog(request)
}
