import { describe, expect, it } from 'vitest'
import { FALLBACK_PAYMENT_METHODS, MAX_PAYMENT_METHODS, PAYMENT_COLORS, PAYMENT_SHORTCUT_KEYS, paymentColor } from './paymentMethods'

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
