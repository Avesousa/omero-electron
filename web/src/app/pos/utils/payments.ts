import { isFallbackMethod, type PaymentMethod, type PaymentMethodKind } from '@/shared/constants/paymentMethods'

/** Importe recibido con un medio de pago en el cobro en curso. */
export interface PaymentLine {
  methodId: string
  kind: PaymentMethodKind
  name: string
  color: string
  amount: number
}

/** Suma (o agrega) un importe a la línea del mismo medio, conservando el orden en que se fueron cobrando. */
export function addPaymentLine(lines: PaymentLine[], method: PaymentMethod, amount: number): PaymentLine[] {
  const i = lines.findIndex(l => l.methodId === method.id)
  if (i >= 0) return lines.map((l, idx) => (idx === i ? { ...l, amount: l.amount + amount } : l))
  return [...lines, { methodId: method.id, kind: method.kind, name: method.name, color: method.color, amount }]
}

export const sumPayments = (lines: PaymentLine[]): number => lines.reduce((s, l) => s + l.amount, 0)

export const sumByKind = (lines: PaymentLine[], kind: PaymentMethodKind): number =>
  lines.filter(l => l.kind === kind).reduce((s, l) => s + l.amount, 0)

/** Cuerpo de pagos de `POST /api/sales` (y de la cola offline). */
export interface SalePaymentsPayload {
  /** Formato viejo: lo siguen entendiendo los backends/clientes sin medios de pago configurables. */
  cashAmount: number
  mpAmount: number
  /** Formato nuevo (importes recibidos por medio). Ausente si algún medio es el de respaldo (sin id real). */
  payments?: Array<{ paymentMethodId: string; amount: number }>
}

/**
 * Arma los pagos de la venta. Se envían AMBOS formatos: el backend nuevo usa `payments`, uno anterior (o un cliente
 * viejo con la cola) sigue leyendo cashAmount/mpAmount. Los medios de respaldo (web sin conexión al cargar) no tienen
 * id real: en ese caso solo viaja el formato viejo.
 */
export function buildSalePayments(lines: PaymentLine[]): SalePaymentsPayload {
  const base: SalePaymentsPayload = {
    cashAmount: sumByKind(lines, 'CASH'),
    mpAmount: sumByKind(lines, 'MERCADOPAGO'),
  }
  if (lines.some(l => isFallbackMethod({ id: l.methodId }))) return base
  return { ...base, payments: lines.map(l => ({ paymentMethodId: l.methodId, amount: l.amount })) }
}
