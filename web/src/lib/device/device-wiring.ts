import { getSyncer } from '../catalog/syncer'
import { getDeviceSession } from './device-session'

let wired = false

/**
 * Conecta la sesión de la caja con el CatalogSyncer (dónde queda el JWT renovado). Idempotente. Vive en un módulo
 * aparte para que `device-session` no importe al syncer (el syncer usará la sesión de la caja para renovar).
 */
export function wireDevice(): void {
  if (wired) return
  wired = true
  const session = getDeviceSession()
  const syncer = getSyncer()
  session.setSink(syncer)
  syncer.setRenewer(async (tenantId) => (await session.refresh(tenantId)).ok)
}

/** Solo tests. */
export function resetWiring(): void {
  wired = false
}
