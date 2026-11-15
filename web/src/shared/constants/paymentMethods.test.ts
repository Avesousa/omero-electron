import { describe, expect, it } from 'vitest'
import { FALLBACK_PAYMENT_METHODS, MAX_PAYMENT_METHODS, PAYMENT_COLORS, PAYMENT_SHORTCUT_KEYS, checkoutMethods, paymentColor } from './paymentMethods'

describe('constantes de medios de pago', () => {
  it('la paleta tiene 10 colores con claves únicas', () => {
    expect(PAYMENT_COLORS).toHaveLength(10)
    expect(new Set(PAYMENT_COLORS.map(c => c.key)).size).toBe(10)
  })

  it('máximo 6 medios y teclas 1-6', () => {
    expect(MAX_PAYMENT_METHODS).toBe(6)
    expect(PAYMENT_SHORTCUT_KEYS).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('un color desconocido cae al primero de la paleta', () => {
    expect(paymentColor('nope').key).toBe(PAYMENT_COLORS[0].key)
  })

  it('los medios de respaldo conservan las teclas de siempre: 1 MercadoPago, 2 Efectivo', () => {
    expect(FALLBACK_PAYMENT_METHODS.map(m => [m.shortcutKey, m.kind])).toEqual([[1, 'MERCADOPAGO'], [2, 'CASH']])
  })
})

describe('checkoutMethods (crédito según permiso)', () => {
  const list = [{ kind: 'CASH' }, { kind: 'MERCADOPAGO' }, { kind: 'CREDIT' }]
  it('sin POS_CREDITO_USAR oculta el crédito aunque venga de un snapshot offline', () => {
    expect(checkoutMethods(list, { canCredit: false }).map(m => m.kind)).toEqual(['CASH', 'MERCADOPAGO'])
  })
  it('con permiso lo muestra, salvo que no haya una venta nueva que fiar', () => {
    expect(checkoutMethods(list, { canCredit: true }).map(m => m.kind)).toContain('CREDIT')
    expect(checkoutMethods(list, { canCredit: true, hasSale: false }).map(m => m.kind)).not.toContain('CREDIT')
  })
})
