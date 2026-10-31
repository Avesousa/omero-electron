import { tenantFromAuthHeader } from '../catalog/tenant'
import { getRuntime } from '../runtime'
import { getDeviceSession, type SessionCode } from './device-session'
import { getDeviceState } from './device-state'
import { wireDevice } from './device-wiring'

/**
 * Endpoints locales de la sesión de la caja (`/api/_local/session*`, no se proxean al backend). Solo desktop; en web
 * responden "sin caja". La renovación NO lleva Authorization (el JWT del renderer ya venció): el tenant sale de una
 * pista (JWT vencido, si el renderer aún lo tiene) o de la última sesión de la caja. Riesgo aceptado (decisión de la
 * fase 4): sin guardia local, cualquier proceso de esta máquina que llegue a 127.0.0.1 puede pedir un JWT `pos`.
 */

const STATUS: Record<SessionCode, number> = {
  NO_DEVICE: 401,
  LOGIN_REQUIRED: 401,
  DEVICE_EXPIRED: 401,
  DEVICE_SECRET_INVALID: 401,
  DEVICE_REVOKED: 403,
  SYNC_WINDOW_CLOSED: 403,
  UNAVAILABLE: 503,
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}

function isDesktop(): boolean {
  try {
    return getRuntime() === 'desktop'
  } catch {
    return false
  }
}

function failure(code: SessionCode, message: string): Response {
  return json(STATUS[code], { success: false, error: message, code })
}

/** POST /api/_local/session/refresh */
export async function refreshLocalSession(request: Request): Promise<Response> {
  if (!isDesktop() || !getDeviceState().enabled) return failure('NO_DEVICE', 'Esta instalación no usa sesión de dispositivo')
  wireDevice()
  const tenantId = getDeviceState().resolveTenant(tenantFromAuthHeader(request.headers.get('authorization')))
  if (!tenantId) return failure('NO_DEVICE', 'No hay una caja con sesión')

  const r = await getDeviceSession().refresh(tenantId)
  if (!r.ok) return failure(r.code, r.message)
  return json(200, { success: true, data: { accessToken: r.accessToken, expiresIn: r.expiresIn, user: r.user } })
}

/** GET /api/_local/session → estado de la caja para la UI (nunca el secreto). */
export function getLocalSession(request: Request): Response {
  const state = getDeviceState()
  const desktop = isDesktop() && state.enabled
  const tenantId = desktop ? state.resolveTenant(tenantFromAuthHeader(request.headers.get('authorization'))) : null
  const entry = tenantId ? state.get(tenantId) : null
  return json(200, {
    success: true,
    data: { desktop, hasDevice: !!entry, sessionActive: entry?.sessionActive ?? false },
  })
}

/** DELETE /api/_local/session → logout de la caja (conserva el secreto para subir lo pendiente). */
export async function logoutLocalSession(request: Request): Promise<Response> {
  if (!isDesktop() || !getDeviceState().enabled) return new Response(null, { status: 204 })
  wireDevice()
  const tenantId = getDeviceState().resolveTenant(tenantFromAuthHeader(request.headers.get('authorization')))
  if (tenantId) await getDeviceSession().logout(tenantId)
  return new Response(null, { status: 204 })
}
