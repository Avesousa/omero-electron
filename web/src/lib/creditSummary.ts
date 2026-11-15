import type { PaymentBreakdown } from '@/shared/constants/paymentMethods'

/**
 * El crédito (fiado) en los desgloses por medio de pago es REFERENCIA: la fila `kind=CREDIT` es lo fiado, no dinero
 * cobrado, así que nunca suma a lo cobrado/ingresos.
 */
export const isCreditRow = (r: Pick<PaymentBreakdown, 'kind'>): boolean => r.kind === 'CREDIT'

/** Filas de dinero realmente cobrado (sin la fila de crédito). */
export const collectedRows = (rows: readonly PaymentBreakdown[] | undefined): PaymentBreakdown[] => (rows ?? []).filter(r => !isCreditRow(r))

/** Fila de referencia del crédito (lo fiado en el período), si hay. */
export const creditReferenceRow = (rows: readonly PaymentBreakdown[] | undefined): PaymentBreakdown | undefined => (rows ?? []).find(isCreditRow)

/** Suma de lo cobrado: ignora la fila de crédito. */
export const sumCollected = (rows: readonly PaymentBreakdown[] | undefined): number => collectedRows(rows).reduce((a, r) => a + r.amount, 0)
