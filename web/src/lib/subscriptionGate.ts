import { SUBSCRIPTION_INACTIVE_CODE } from '@/lib/entitlement/rule'

/**
 * "Compuerta" global de la suscripción del POS: se ABRE (bloquea) cuando cualquier respuesta del backend/local trae
 * 403 `SUBSCRIPTION_INACTIVE` y se CIERRA sola cuando `useEntitlement` confirma que volvió el acceso. Bloquear NO toca
 * la sesión ni la caja: solo muestra la pantalla bloqueante (el outbox sigue subiendo lo pendiente en el servidor local).
 */

let inactive = false
const listeners = new Set<() => void>()

function set(value: boolean): void {
  if (inactive === value) return
  inactive = value
  listeners.forEach((l) => l())
}

export const markSubscriptionInactive = (): void => set(true)
export const clearSubscriptionInactive = (): void => set(false)
export const isSubscriptionMarkedInactive = (): boolean => inactive

/** ¿Esta respuesta es el 403 de suscripción inactiva? (`body` ya parseado; tolera cualquier forma). */
export function isSubscriptionInactiveResponse(status: number, body: unknown): boolean {
  return status === 403 && typeof body === 'object' && body !== null && (body as { code?: unknown }).code === SUBSCRIPTION_INACTIVE_CODE
}

/** Marca la compuerta si la respuesta es el 403 de suscripción. Devuelve si lo era. */
export function handleSubscriptionResponse(status: number, body: unknown): boolean {
  const hit = isSubscriptionInactiveResponse(status, body)
  if (hit) markSubscriptionInactive()
  return hit
}

/** Para `useSubscriptionMarkedInactive` (en useEntitlement.ts): este módulo no importa React porque lo carga también
 *  el lado servidor (apiClient → authService → layout). */
export function subscribeSubscriptionGate(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
