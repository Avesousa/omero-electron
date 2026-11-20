export type MpReconciliationStatus = 'PENDING' | 'MATCHED' | 'VALIDATED'

export type MpLinkTargetType = 'SALE' | 'CREDIT_PAYMENT'

/** Reparto de `amount` de una transacción a una venta o a un cobro de crédito. `id` llega como texto (Long). */
export interface MpLink {
  id: string
  transactionId: string
  targetType: MpLinkTargetType
  /** Id de la venta (número como texto) o UUID del cobro de crédito. */
  targetId: string
  amount: number
  createdAt: string
  /** Solo con `targetType === 'CREDIT_PAYMENT'` (ausentes en un backend viejo). */
  customerCode?: number | null
  customerName?: string | null
}

export interface MpTransaction {
  id: string
  amount: number
  direction: 'INCOMING' | 'OUTGOING'
  mpStatus: string | null
  paymentTypeId: string | null
  operationType: string | null
  source: 'WEBHOOK' | 'POLLING'
  occurredAt: string
  reconciliationStatus: MpReconciliationStatus
  /** Compatibilidad: venta del primer vínculo. La fuente de verdad es `links`. */
  saleId: number | null
  saleTotal: number | null
  note: string | null
  /** Ausentes en un backend viejo: se tratan como "sin vínculos". */
  links?: MpLink[]
  linkedAmount?: number
  /** Monto sin repartir (nunca negativo). */
  unallocatedAmount?: number
}

export function mpPaymentLabel(paymentTypeId: string | null): string {
  switch (paymentTypeId) {
    case 'bank_transfer': return 'Transferencia'
    case 'credit_card':
    case 'debit_card': return 'Tarjeta'
    case 'account_money': return 'Dinero en cuenta'
    default: return paymentTypeId ? paymentTypeId : 'QR'
  }
}
