import { proxyToBackend } from './backend-proxy'
import { proxyWithCatalog } from './catalog/catalog-proxy'
import { getRuntime } from './runtime'
import { handleOutboxRequest, matchOutboxRoute } from './outbox/outbox-proxy'
import { endedResponse, reportEndedResponse } from './device/session-ended'
import { getDeviceState } from './device/device-state'
import { tenantFromAuthHeader } from './catalog/tenant'
import { handleLogin, isLoginRoute, validateDeviceOnRequest } from './device/session-proxy'
import { handleEntitlementRequest, isEntitlementRoute } from './entitlement/entitlement-proxy'

/**
 * Capa de datos de `/api/*`. Único punto de entrada del route handler catch-all.
 *
 *   web     → proxy directo al backend (sin caché ni SQLite; el módulo nativo NUNCA se carga)
 *   desktop → `POST /api/auth/login` registra la caja (`session-proxy`); lecturas de catálogo con SQLite (`catalog-proxy`);
 *             `GET /api/billing/entitlement` con caché persistente (`entitlement-proxy`);
 *             `POST /api/sales` y `POST /api/expenses` al outbox
 *             SQLite (`outbox-proxy`, se suben en segundo plano); el resto, proxy directo
 *
 * Punto de extensión: cualquier nueva ruta con comportamiento offline se agrega acá, sin tocar el route handler ni
 * el proxy. Si el outbox no está disponible la request sigue por el camino anterior (degradación sin error).
 */
export async function handleApiRequest(request: Request): Promise<Response> {
  const response = await dispatch(request)
  // 403 DEVICE_REVOKED / DEVICE_EXPIRED / LOGIN_REQUIRED de CUALQUIER request: la sesión de la caja termina YA
  if (response.status === 403 && getDeviceState().enabled) {
    await reportEndedResponse(tenantFromAuthHeader(request.headers.get('authorization')) ?? getDeviceState().resolveTenant(), response)
  }
  return response
}

/** Si la caja de la request ya tiene la sesión terminada, la respuesta local (403 + code) que la corta. */
function endedByDevice(request: Request): Response | null {
  const state = getDeviceState()
  if (!state.enabled) return null
  const tenantId = tenantFromAuthHeader(request.headers.get('authorization'))
  const code = tenantId ? state.endedReason(tenantId) : null
  return code ? endedResponse(code) : null
}

async function dispatch(request: Request): Promise<Response> {
  let runtime: string
  try {
    runtime = getRuntime()
  } catch {
    // instrumentation ya valida el entorno al arrancar; si igual falta, se comporta como web
    return proxyToBackend(request)
  }
  if (runtime !== 'desktop') return proxyToBackend(request)

  const pathname = new URL(request.url).pathname
  if (isLoginRoute(request.method, pathname)) return handleLogin(request) // registra la caja (sesión larga)

  const ended = endedByDevice(request)
  if (ended) return ended // la caja terminó (revocada / vencida / exige login): ninguna operación contra el backend con el JWT pos

  validateDeviceOnRequest(request) // validación pasiva de la sesión de la caja (como mucho 1 vez cada 24 h; no frena la request)

  if (isEntitlementRoute(request.method, pathname)) return handleEntitlementRequest(request) // suscripción, con caché offline

  const outboxType = matchOutboxRoute(request.method, pathname)
  if (outboxType) {
    const queued = await handleOutboxRequest(request, outboxType)
    if (queued) return queued
  }
  return proxyWithCatalog(request)
}
