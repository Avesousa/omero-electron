export type MpReconciliationStatus = 'PENDING' | 'MATCHED' | 'VALIDATED'

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
  saleId: number | null
  saleTotal: number | null
  note: string | null
}

export interface MpSale {
  id: number
  total: number
  mpAmount: number
  createdAt: string
  mpStatus: MpReconciliationStatus
  transactionId: string | null
  note: string | null
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
