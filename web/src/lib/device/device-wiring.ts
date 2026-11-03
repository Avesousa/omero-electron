import { getSyncer } from '../catalog/syncer'
import { getDeviceSession } from './device-session'

let wired = false

/**
 * Conecta la sesión de la caja con el CatalogSyncer (dónde queda el JWT renovado y quién valida la sesión en cada ciclo).
 * Idempotente. Vive en un módulo aparte para que `device-session` no importe al syncer.
 */
export function wireDevice(): void {
  if (wired) return
  wired = true
  const session = getDeviceSession()
  const syncer = getSyncer()
  session.setSink(syncer)
  syncer.setRenewer(async (tenantId) => (await session.refresh(tenantId)).ok)
  // Validación pasiva (cada 24 h como mucho): la dispara el ciclo del syncer que YA existe, nunca un reloj propio.
  syncer.setValidator((tenantId) => session.validateIfDue(tenantId))
}

/**
 * Arranque del servidor local: valida las cajas con sesión activa si pasaron >= 24 h desde la última validación.
 * Una sola pasada (no deja timers). Solo con identidad de caja.
 */
export function validateDevicesOnStart(): void {
  const session = getDeviceSession()
  if (!session.state.enabled) return
  wireDevice()
  for (const tenantId of session.state.activeTenants()) void session.validateIfDue(tenantId)
}

/** Solo tests. */
export function resetWiring(): void {
  wired = false
}
