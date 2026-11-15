import { friendlyError } from '@/lib/apiErrors'

/** Códigos estables del backend (clientes y crédito) → texto en español. Nunca se muestra el texto crudo del servidor. */
export const CREDIT_CODE_MESSAGES: Record<string, string> = {
  CUSTOMER_NOT_FOUND: 'El cliente no existe. Recargá la pantalla.',
  CUSTOMER_CODE_TAKEN: 'Ya existe un cliente con ese código.',
  CUSTOMER_CODE_INVALID: 'El código debe ser un número entero positivo.',
  CUSTOMER_NAME_TOO_LONG: 'El nombre es demasiado largo.',
  CUSTOMER_FIELD_REQUIRED: 'Completá los campos obligatorios del cliente.',
  CUSTOMER_FIELD_INVALID: 'Uno de los campos extra no es válido.',
  CUSTOMER_FIELD_LIMIT: 'Se pueden configurar hasta 4 campos extra.',
  CUSTOMER_FIELD_LABEL_REQUIRED: 'Cada campo extra necesita un nombre.',
  CUSTOMER_FIELD_LABEL_TOO_LONG: 'El nombre del campo extra es demasiado largo.',
  CUSTOMER_FIELD_TOO_LONG: 'Un campo extra del cliente es demasiado largo.',
  CUSTOMER_INACTIVE: 'El cliente está inactivo: no se le puede vender a crédito.',
  CREDIT_CUSTOMER_REQUIRED: 'Elegí el cliente al que se le fía.',
  CREDIT_AMOUNT_EXCEEDS_TOTAL: 'El crédito no puede superar el total de la venta.',
  CREDIT_AMOUNT_EXCEEDS_DEBT: 'El monto cobrado supera la deuda del cliente.',
  CREDIT_AMOUNT_INVALID: 'El monto del crédito no es válido.',
  CREDIT_PAYMENT_REQUIRED: 'Ingresá al menos un pago para cobrar el crédito.',
  CREDIT_METHOD_NOT_ALLOWED: 'El medio Crédito no sirve para cobrar una deuda: usá efectivo u otro medio.',
  CREDIT_METHOD_DISABLED: 'El crédito está desactivado. Habilitalo en Configuración > Medios de pago.',
  CREDIT_PERMISSION_REQUIRED: 'No tenés permiso para vender a crédito.',
  PAYMENT_METHOD_INVALID_KIND: 'Ese tipo de medio de pago no se puede crear.',
  PAYMENT_AMOUNT_INVALID: 'El importe de un pago es inválido.',
  PAYMENT_METHOD_NOT_FOUND: 'El medio de pago no existe. Recargá la pantalla.',
  PAYMENT_METHOD_INACTIVE: 'El medio de pago está desactivado.',
}

/** Texto en español para un error del backend de clientes/crédito: primero por `code`, si no por `friendlyError`. */
export function creditError(r: { error?: string; code?: string }, fallback: string): string {
  if (r.code && CREDIT_CODE_MESSAGES[r.code]) return CREDIT_CODE_MESSAGES[r.code]
  return friendlyError(r.error, fallback)
}

/** Textos de conexión que producen el proxy local (`backend-proxy`) y `apiFetch`: el backend no respondió. */
const CONNECTION_ERRORS = [
  'No se pudo conectar con el servidor.',
  'El servidor tardó demasiado en responder.',
  'No se pudo conectar con el servidor. Reintentá en unos segundos.',
  'Sin conexión con el servidor. Probá de nuevo en unos instantes.',
]

/** true si el error significa "sin conexión con el backend" (no un rechazo del backend). */
export const isConnectionError = (error: string | undefined): boolean => CONNECTION_ERRORS.includes((error ?? '').trim())

/** El alta rápida no tiene soporte offline: el código del cliente lo asigna el backend. */
export const OFFLINE_CUSTOMER_MESSAGE =
  'Sin conexión: no se puede crear un cliente nuevo ahora. Elegí uno de la lista o cobrá con otro medio.'

/** El detalle (líneas pendientes) solo está offline si el cliente se consultó antes con conexión. */
export const OFFLINE_DETAIL_MESSAGE =
  'Sin conexión: no hay datos guardados de la deuda de este cliente. Probá de nuevo cuando vuelva la conexión.'
