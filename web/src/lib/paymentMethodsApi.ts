import { apiFetch, type ApiResult } from '@/lib/apiClient'
import type { PaymentMethod } from '@/shared/constants/paymentMethods'

/** Códigos estables del backend → texto en español (nunca se muestra el texto crudo del servidor). */
const CODE_MESSAGES: Record<string, string> = {
  PAYMENT_METHOD_LIMIT: 'Ya tenés el máximo de 6 medios de pago.',
  PAYMENT_METHOD_NOT_FOUND: 'El medio de pago no existe. Recargá la pantalla.',
  PAYMENT_METHOD_INACTIVE: 'El medio de pago está desactivado.',
  PAYMENT_METHOD_NOT_SUPPORTED: 'Este medio de pago todavía no está disponible.',
  PAYMENT_AMOUNT_INVALID: 'El importe de un pago es inválido.',
  PAYMENT_METHOD_IN_USE: 'Este medio de pago ya tiene ventas registradas: desactivalo en lugar de eliminarlo.',
  PAYMENT_METHOD_SYSTEM_LOCKED: 'Este medio de pago es del sistema.',
}

/** Igual que `friendlyError` de omero: lo genérico o vacío se reemplaza por un texto en español. */
function friendly(error: string | undefined, fallback: string): string {
  const e = (error ?? '').trim()
  if (!e) return fallback
  if (/^Error \d{3}$/.test(e)) return fallback
  if (/^(forbidden|access denied|unauthorized|internal server error|bad request|not found)/i.test(e)) return fallback
  return e
}

export function paymentMethodError(r: { error?: string; code?: string }, fallback: string): string {
  if (r.code && CODE_MESSAGES[r.code]) return CODE_MESSAGES[r.code]
  return friendly(r.error, fallback)
}

/**
 * Medios de pago activos del cobro. En desktop esta lectura la sirve la caché SQLite cuando no hay conexión
 * (`catalog/cache-policy`: `/api/payment-methods/active`).
 */
export async function fetchActivePaymentMethods(): Promise<ApiResult<PaymentMethod[]>> {
  const r = await apiFetch<PaymentMethod[]>('/api/payment-methods/active')
  return r.success ? r : { ...r, error: paymentMethodError(r as { error?: string; code?: string }, 'No se pudieron cargar los medios de pago.') }
}
