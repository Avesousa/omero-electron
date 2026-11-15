import type { PaymentMethodKind } from '@/shared/constants/paymentMethods'

/**
 * Clientes y crédito (fiado). Contrato del backend: `/api/customers`, `/api/credit` (omero-backend, V38).
 * Los importes llegan como número; los `Long` como string.
 */

export interface Customer {
  /** uuid */
  id: string
  /** Código numérico corto (se tipea en el POS). */
  code: number
  name: string
  active: boolean
  /** Campos extra por posición: { "1": "...", "2": "..." }. */
  extra: Record<string, string>
  /** Deuda vigente valuada con los PRECIOS ACTUALES. */
  debt: number
  pendingLines: number
  oldestPendingAt: string | null
  createdAt: string
}

export type CreditLineStatus = 'PENDING' | 'PAID'

export interface CreditLine {
  saleItemId: string
  saleId: number
  soldAt: string
  productCode: string | null
  productName: string | null
  quantity: number
  saleUnit?: 'UNIT' | 'KG'
  /** Lo fiado originalmente. */
  originalAmount: number
  /** Lo abonado hasta ahora. */
  paid: number
  /** Valor de la línea con los precios actuales. */
  currentValue: number
  /** Lo que se debe hoy. */
  debt: number
  status: CreditLineStatus
  settledAt: string | null
}

export type CollectionReviewStatus = 'NONE' | 'NEEDS_REVIEW' | 'REVIEWED'

export type CollectionReviewReason =
  | 'CREDIT_OVERPAYMENT'
  | 'CREDIT_DEBT_CHANGED'
  | 'PAYMENT_METHOD_NOT_FOUND'
  | 'CREATED_AT_TOO_OLD'
  | 'CREATED_AT_IN_FUTURE'
  | 'DEVICE_REVOKED'

export interface CollectionPayment {
  paymentMethodId: string
  name: string
  kind: PaymentMethodKind
  color: string
  amount: number
}

export interface CollectionAllocation {
  saleItemId: string
  amount: number
  debtBefore: number
  lineSettled: boolean
}

export interface Collection {
  id: string
  customerId: string
  /** Hora real del cobro (en el POS offline, la de la caja). */
  paidAt: string
  /** Lo que entregó el cliente. */
  amount: number
  /** Lo que se imputó a líneas (puede ser menos que `amount` si se pasó). */
  allocatedAmount: number
  source?: string
  reviewStatus: CollectionReviewStatus
  reviewReasons: CollectionReviewReason[]
  reviewNote?: string | null
  clientId?: string | null
  payments: CollectionPayment[]
  allocations: CollectionAllocation[]
}

export interface CustomerDetail {
  customer: Customer
  lines: CreditLine[]
  collections: Collection[]
}

export interface CustomerField {
  id?: string
  slot: number
  label: string
  required: boolean
  active: boolean
}

export interface CollectResult {
  /** Ausente cuando el cobro quedó en el outbox de la caja (desktop): todavía no existe en el backend. */
  collection?: Collection
  /** Deuda del cliente después del cobro; aproximada (caché − pendientes) si el cobro quedó en el outbox; null si no se conoce. */
  debtAfter: number | null
  duplicate: boolean
  /** true = guardado en el outbox de la caja (desktop); se sube solo al backend. */
  queued?: boolean
}

/** Resumen de crédito de dashboard / resumen del día (siempre REFERENCIA, no suma a lo cobrado). */
export interface CreditSummary {
  /** Fiado en el período. */
  issued: number
  /** Cobrado en el período de ventas fiadas antes. */
  collected: number
  /** Deuda vigente total. */
  pending: number
  collectionsByMethod: Array<{ paymentMethodId: string; name: string; kind: PaymentMethodKind; color: string; amount: number }>
}

export const COLLECTION_REASON_LABEL: Record<CollectionReviewReason, string> = {
  CREDIT_OVERPAYMENT: 'El cliente entregó más que la deuda: se imputó hasta la deuda',
  CREDIT_DEBT_CHANGED: 'La deuda cambió (precios) entre el cobro en la caja y su sincronización',
  PAYMENT_METHOD_NOT_FOUND: 'El medio de pago ya no existe: se registró como efectivo',
  CREATED_AT_TOO_OLD: 'Fecha de la caja muy antigua',
  CREATED_AT_IN_FUTURE: 'Fecha de la caja en el futuro',
  DEVICE_REVOKED: 'Cobrado en una caja que fue revocada (hecho antes de la revocación)',
}

export function collectionReasonLabel(reason: string): string {
  return COLLECTION_REASON_LABEL[reason as CollectionReviewReason] ?? reason
}

/** Motivos de revisión de VENTAS propios del crédito (los demás están en salesReview). */
export const CREDIT_SALE_REASON_LABEL: Record<string, string> = {
  CUSTOMER_NOT_FOUND: 'Venta a crédito sin cliente: asignale uno',
  CREDIT_AMOUNT_ADJUSTED: 'El monto a crédito se ajustó al sincronizar',
  CREDIT_METHOD_DISABLED: 'Se vendió a crédito con el medio Crédito desactivado',
  CREDIT_NOT_ALLOWED: 'Se vendió a crédito sin permiso para usar el crédito',
}

export const CREDIT_STATUS_LABEL: Record<CreditLineStatus, string> = { PENDING: 'Pendiente', PAID: 'Pagado' }

export const COLLECTION_REVIEW_LABEL: Record<CollectionReviewStatus, string> = {
  NONE: 'Sin revisión',
  NEEDS_REVIEW: 'A revisar',
  REVIEWED: 'Revisado',
}
