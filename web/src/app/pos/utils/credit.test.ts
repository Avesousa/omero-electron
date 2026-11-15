import { describe, expect, it } from 'vitest'
import type { Customer, CreditLine } from '@/shared/types/credit'
import type { PaymentLine } from './payments'
import { creditAmountError, filterCustomersByCode, parseCollectAmount, singleMatch, splitPaymentsForCollection, toCreditCartItems, withDebt } from './credit'

const c = (code: number, debt = 0): Customer => ({ id: `id${code}`, code, name: `C${code}`, active: true, extra: {}, debt, pendingLines: 0, oldestPendingAt: null, createdAt: '' })
const line = (kind: PaymentLine['kind'], amount: number): PaymentLine => ({ methodId: kind, kind, name: kind, color: 'green', amount })

describe('filtrado de clientes por código', () => {
  const all = [c(70), c(7), c(42), c(700)]
  it('sin texto: todos ordenados por código', () => expect(filterCustomersByCode(all, '').map(x => x.code)).toEqual([7, 42, 70, 700]))
  it('prefijo: el código exacto va primero', () => expect(filterCustomersByCode(all, '7').map(x => x.code)).toEqual([7, 70, 700]))
  it('un único resultado es el que toma Enter', () => {
    expect(singleMatch(filterCustomersByCode(all, '42'))?.code).toBe(42)
    expect(singleMatch(filterCustomersByCode(all, '7'))).toBeNull()
    expect(filterCustomersByCode(all, '9')).toEqual([])
  })
  it('withDebt deja solo deudores', () => expect(withDebt([c(1, 0), c(2, 10)]).map(x => x.code)).toEqual([2]))
})

describe('crédito en el cobro', () => {
  it('no supera el total de la venta ni lo que resta (sin vuelto)', () => {
    expect(creditAmountError(0, 100, 0, 100)).toMatch(/mayor a cero/)
    expect(creditAmountError(120, 100, 0, 100)).toMatch(/total de la venta/)
    expect(creditAmountError(60, 100, 50, 100)).toMatch(/total de la venta/)
    expect(creditAmountError(80, 100, 0, 50)).toMatch(/no da vuelto/)
    expect(creditAmountError(100, 100, 0, 100)).toBeNull()
  })
})

describe('cobro de deuda', () => {
  it('parseCollectAmount: vacío = toda la deuda; valida rango', () => {
    expect(parseCollectAmount('', 500)).toEqual({ amount: 500, error: null })
    expect(parseCollectAmount('200,5', 500)).toEqual({ amount: 200.5, error: null })
    expect(parseCollectAmount('0', 500).error).toBeTruthy()
    expect(parseCollectAmount('600', 500).error).toMatch(/superar la deuda/)
  })
  it('reparte los pagos: primero a la deuda, el resto a la venta; el crédito nunca cancela deuda', () => {
    const r = splitPaymentsForCollection([line('CASH', 300), line('CREDIT', 100), line('MERCADOPAGO', 400)], 500)
    expect(r.collect.map(l => [l.kind, l.amount])).toEqual([['CASH', 300], ['MERCADOPAGO', 200]])
    expect(r.sale.map(l => [l.kind, l.amount])).toEqual([['CREDIT', 100], ['MERCADOPAGO', 200]])
  })
  it('las líneas pendientes pasan a ítems de carrito de crédito (solo PENDING)', () => {
    const base = { saleItemId: 's1', saleId: 1, soldAt: '', productCode: null, productName: null, quantity: 2, originalAmount: 10, paid: 0, currentValue: 10, debt: 10, settledAt: null }
    const items = toCreditCartItems([{ ...base, status: 'PENDING' } as CreditLine, { ...base, saleItemId: 's2', status: 'PAID' } as CreditLine])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'CREDIT_LINE', code: '000', name: 'Producto', debt: 10 })
  })
})
