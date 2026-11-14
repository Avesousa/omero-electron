import { describe, expect, it } from 'vitest'
import { paymentMethodError } from './paymentMethodsApi'

describe('paymentMethodError', () => {
  it('traduce los códigos del backend a español', () => {
    expect(paymentMethodError({ error: 'Ya tenés el máximo de 6 medios de pago', code: 'PAYMENT_METHOD_LIMIT' }, 'x')).toContain('máximo de 6')
    expect(paymentMethodError({ error: 'raw english', code: 'PAYMENT_METHOD_IN_USE' }, 'x')).toContain('desactivalo')
  })

  it('sin código usa el texto del servidor si está en español o el fallback si es genérico', () => {
    expect(paymentMethodError({ error: 'Error 500' }, 'No se pudo guardar.')).toBe('No se pudo guardar.')
    expect(paymentMethodError({ error: 'Algo en español' }, 'x')).toBe('Algo en español')
  })
})
