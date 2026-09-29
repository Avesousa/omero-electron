/**
 * Entitlement de la suscripción del negocio (contrato de `GET /api/billing/entitlement` de omero-backend) y regla de
 * bloqueo de venta del POS. Funciones PURAS, compartidas por el servidor local (Next, antes de encolar en el outbox) y
 * por el renderer (pantalla bloqueante). Sin dependencias de Node ni de React.
 */

export interface Entitlement {
  status: string
  /** Acceso efectivo según el backend al momento de la consulta. */
  accessGranted: boolean
  /** ISO-8601; null = sin vencimiento. */
  accessUntil: string | null
  trialEndsAt: string | null
  graceUntil: string | null
  planCode: string | null
  courtesy: boolean
  /** false = el backend no exige suscripción (BILLING_ENFORCEMENT_ENABLED apagado). */
  enforced: boolean
  canManage: boolean
}

/** Lo que se guarda en disco: el último entitlement conocido y cuándo se obtuvo del backend. */
export interface CachedEntitlement {
  entitlement: Entitlement
  /** ISO-8601 del momento en que el backend respondió. */
  fetchedAt: string
}

export const SUBSCRIPTION_INACTIVE_CODE = 'SUBSCRIPTION_INACTIVE'
export const SALE_BLOCKED_MESSAGE = 'La suscripción del negocio venció. Comunicate con el administrador.'

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const optString = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

/**
 * Valida y normaliza el `data` del endpoint. Devuelve null si no tiene la forma esperada (nunca lanza): una respuesta
 * rara no debe pisar la caché buena ni bloquear al cajero.
 */
export function parseEntitlement(raw: unknown): Entitlement | null {
  if (!isObj(raw)) return null
  if (typeof raw.status !== 'string' || typeof raw.accessGranted !== 'boolean' || typeof raw.enforced !== 'boolean') return null
  return {
    status: raw.status,
    accessGranted: raw.accessGranted,
    accessUntil: optString(raw.accessUntil),
    trialEndsAt: optString(raw.trialEndsAt),
    graceUntil: optString(raw.graceUntil),
    planCode: optString(raw.planCode),
    courtesy: raw.courtesy === true,
    enforced: raw.enforced,
    canManage: raw.canManage === true,
  }
}

/** Valida la forma completa guardada en disco (`{ entitlement, fetchedAt }`). */
export function parseCached(raw: unknown): CachedEntitlement | null {
  if (!isObj(raw) || typeof raw.fetchedAt !== 'string' || Number.isNaN(Date.parse(raw.fetchedAt))) return null
  const entitlement = parseEntitlement(raw.entitlement)
  return entitlement ? { entitlement, fetchedAt: raw.fetchedAt } : null
}

/**
 * ¿Hay que bloquear la venta? `enforced && status != ADMIN_APPROVED && (!accessGranted || now > accessUntil)`.
 *
 * - Sin entitlement todavía (nunca se pudo consultar) → NO bloquea: no se le corta la venta a un negocio por no haber
 *   podido verificar.
 * - Offline se vende hasta `accessUntil`: aunque el último `accessGranted` conocido sea true, pasada la fecha se bloquea.
 * - Una fecha ilegible no bloquea por sí sola (se confía en `accessGranted`).
 */
export function isAccessBlocked(entitlement: Entitlement | null | undefined, now: number): boolean {
  if (!entitlement || !entitlement.enforced) return false
  if (entitlement.status === 'ADMIN_APPROVED') return false
  if (!entitlement.accessGranted) return true
  if (entitlement.accessUntil !== null) {
    const until = Date.parse(entitlement.accessUntil)
    if (!Number.isNaN(until) && now > until) return true
  }
  return false
}
