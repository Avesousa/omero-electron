import { proxyToBackend } from './backend-proxy'
import { proxyWithCatalog } from './catalog/catalog-proxy'
import { getRuntime } from './runtime'

/**
 * Capa de datos de `/api/*`. Único punto de entrada del route handler catch-all.
 *
 *   web     → proxy directo al backend (sin caché ni SQLite; el módulo nativo NUNCA se carga)
 *   desktop → lecturas de catálogo con SQLite (`catalog-proxy`); el resto, proxy directo
 *
 * Punto de extensión (fase 3): acá se agregan las escrituras offline (outbox de ventas y gastos) sin tocar
 * el route handler ni el proxy.
 */
export async function handleApiRequest(request: Request): Promise<Response> {
  let runtime: string
  try {
    runtime = getRuntime()
  } catch {
    // instrumentation ya valida el entorno al arrancar; si igual falta, se comporta como web
    return proxyToBackend(request)
  }
  return runtime === 'desktop' ? proxyWithCatalog(request) : proxyToBackend(request)
}
