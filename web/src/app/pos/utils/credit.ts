import type { CreditLine, Customer } from '@/shared/types/credit'
import type { CreditCartItem } from '../types'
import { isFallbackMethod } from '@/shared/constants/paymentMethods'
import { sumByKind, type PaymentLine } from './payments'

/** Redondea a centavos (evita 0.1 + 0.2 en los repartos). */
export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100

/**
 * Filtrado incremental por código: al tipear dígitos quedan los clientes cuyo código EMPIEZA con lo escrito
 * (ordenados por código; un código exacto va primero). Sin texto devuelve todos ordenados por código.
 */
export function filterCustomersByCode(customers: readonly Customer[], query: string): Customer[] {
  const q = query.trim()
  const sorted = [...customers].sort((a, b) => a.code - b.code)
  if (!q) return sorted
  const starts = sorted.filter(c => String(c.code).startsWith(q))
  const exact = starts.filter(c => String(c.code) === q)
  return [...exact, ...starts.filter(c => String(c.code) !== q)]
}

/** Si el filtro dejó un único cliente, es el que Enter selecciona. */
export function singleMatch(matches: readonly Customer[]): Customer | null {
  return matches.length === 1 ? matches[0] : null
}

/** Clientes con deuda (modo «Clientes con crédito»). */
export const withDebt = (customers: readonly Customer[]): Customer[] => customers.filter(c => c.debt > 0)

/**
 * Error del crédito en el cobro (null = ok). El crédito no es dinero entrante: no puede superar el total de la
 * venta nueva (sin contar lo que se cobra de deuda) ni lo que falta pagar (no hay vuelto sobre el crédito).
 */
export function creditAmountError(amount: number, saleTotal: number, alreadyCredit: number, remaining: number): string | null {
  if (!(amount > 0)) return 'Ingresá un monto de crédito mayor a cero.'
  if (round2(alreadyCredit + amount) > round2(saleTotal)) return 'El crédito no puede superar el total de la venta.'
  if (round2(amount) > round2(remaining)) return 'El crédito no da vuelto: ingresá hasta lo que resta pagar.'
  return null
}

export interface SplitPayments {
  /** Pagos que van al cobro de la deuda (suman exactamente `collectAmount`, en el orden ingresado). */
  collect: PaymentLine[]
  /** El resto, que paga la venta nueva (incluye todo el crédito y el exceso que genera el vuelto). */
  sale: PaymentLine[]
}

/**
 * Reparte los pagos ingresados en un mismo cobro: primero al cobro del crédito (en orden) hasta `collectAmount` y
 * el resto a la venta nueva. Las líneas del medio Crédito nunca van al cobro de deuda (el crédito no cancela deuda).
 * Una línea que cruza el límite se parte entre las dos.
 */
export function splitPaymentsForCollection(lines: readonly PaymentLine[], collectAmount: number): SplitPayments {
  let left = round2(collectAmount)
  const collect: PaymentLine[] = []
  const sale: PaymentLine[] = []
  for (const l of lines) {
    if (l.kind === 'CREDIT' || left <= 0) { sale.push(l); continue }
    const take = Math.min(round2(l.amount), left)
    const rest = round2(l.amount - take)
    if (take > 0) collect.push({ ...l, amount: take })
    if (rest > 0) sale.push({ ...l, amount: rest })
    left = round2(left - take)
  }
  return { collect, sale }
}

/** `payments` del cuerpo de `POST /api/credit/collect`. */
export function toCollectPayments(lines: readonly PaymentLine[]): Array<{ paymentMethodId: string; amount: number }> {
  return lines.map(l => ({ paymentMethodId: l.methodId, amount: l.amount }))
}

/** El cobro de deuda necesita ids reales de medios (los de respaldo de la web sin conexión no existen en el backend). */
export const hasFallbackMethod = (lines: readonly PaymentLine[]): boolean => lines.some(l => isFallbackMethod({ id: l.methodId }))

/** Monto a crédito de una lista de pagos. */
export const creditPaid = (lines: readonly PaymentLine[]): number => sumByKind([...lines], 'CREDIT')

/** Valida el monto a cobrar de la deuda (null = ok). `input` vacío = toda la deuda. */
export function parseCollectAmount(input: string, debt: number): { amount: number; error: string | null } {
  const raw = input.trim()
  if (!raw) return { amount: round2(debt), error: null }
  const n = Number(raw.replace(',', '.'))
  if (!Number.isFinite(n) || n <= 0) return { amount: 0, error: 'Ingresá un monto mayor a cero.' }
  if (round2(n) > round2(debt)) return { amount: 0, error: 'El monto no puede superar la deuda del cliente.' }
  return { amount: round2(n), error: null }
}

/** uuid para idempotencia (`clientId`). */
export function newClientId(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c?.randomUUID) return c.randomUUID()
  const h = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0')
  return `${h()}${h()}-${h()}-4${h().slice(1)}-a${h().slice(1)}-${h()}${h()}${h()}`
}

/** Líneas pendientes del cliente como items de carrito de otro tipo (no son productos nuevos, no descuentan stock). */
export function toCreditCartItems(lines: readonly CreditLine[]): CreditCartItem[] {
  return lines
    .filter(l => l.status === 'PENDING')
    .map(l => ({
      kind: 'CREDIT_LINE' as const,
      saleItemId: l.saleItemId,
      saleId: l.saleId,
      soldAt: l.soldAt,
      code: l.productCode ?? '000',
      name: l.productName ?? 'Producto',
      quantity: l.quantity,
      debt: l.debt,
      status: l.status,
    }))
}
