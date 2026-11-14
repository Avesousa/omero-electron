import { describe, expect, it } from 'vitest'
import { FALLBACK_PAYMENT_METHODS, type PaymentMethod } from '@/shared/constants/paymentMethods'
import { addPaymentLine, buildSalePayments, sumByKind, sumPayments } from './payments'

const method = (over: Partial<PaymentMethod>): PaymentMethod => ({
  id: '11111111-1111-1111-1111-111111111111', kind: 'CUSTOM', name: 'Transferencia', shortcutKey: 3, color: 'violet', sortOrder: 3,
  active: true, isDefault: false, generatesExpense: false, expenseRate: 0, expenseCategory: null, expenseDescription: null, deletable: true, ...over,
})
const cash = method({ id: '22222222-2222-2222-2222-222222222222', kind: 'CASH', name: 'Efectivo', shortcutKey: 1, color: 'green' })
const mp = method({ id: '33333333-3333-3333-3333-333333333333', kind: 'MERCADOPAGO', name: 'MercadoPago', shortcutKey: 2, color: 'sky' })

describe('pagos del cobro', () => {
  it('suma al mismo medio y conserva el orden en que se cobró', () => {
    let lines = addPaymentLine([], cash, 100)
    lines = addPaymentLine(lines, mp, 50)
    lines = addPaymentLine(lines, cash, 25)
    expect(lines.map(l => [l.name, l.amount])).toEqual([['Efectivo', 125], ['MercadoPago', 50]])
    expect(sumPayments(lines)).toBe(175)
    expect(sumByKind(lines, 'CASH')).toBe(125)
  })

  it('envía ambos formatos: payments (nuevo) y cashAmount/mpAmount derivados (viejo)', () => {
    const custom = method({})
    let lines = addPaymentLine([], cash, 20)
    lines = addPaymentLine(lines, mp, 30)
    lines = addPaymentLine(lines, custom, 50)
    expect(buildSalePayments(lines)).toEqual({
      cashAmount: 20,
      mpAmount: 30,
      payments: [
        { paymentMethodId: cash.id, amount: 20 },
        { paymentMethodId: mp.id, amount: 30 },
        { paymentMethodId: custom.id, amount: 50 },
      ],
    })
  })

  it('con los medios de respaldo (sin id real) solo viaja el formato viejo', () => {
    const [fbMp, fbCash] = FALLBACK_PAYMENT_METHODS
    const lines = addPaymentLine(addPaymentLine([], fbCash, 70), fbMp, 30)
    const payload = buildSalePayments(lines)
    expect(payload).toEqual({ cashAmount: 70, mpAmount: 30 })
    expect(payload.payments).toBeUndefined()
  })
})
