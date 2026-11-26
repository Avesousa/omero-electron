import { describe, expect, it } from 'vitest'
import cases from '../__fixtures__/promo-cases.json'
import { isPromotionActiveNow } from './schedule'

describe('isPromotionActiveNow (casos compartidos con backend y admin)', () => {
  it.each(cases.scheduleCases)('$name', c => {
    // La caja aplica la promo solo si el estado esperado es ALWAYS.
    expect(isPromotionActiveNow(c.promo, new Date(c.now), c.zone)).toBe(c.expect === 'ALWAYS')
  })

  it('days vacío o null no restringe', () => {
    const now = new Date('2026-11-28T15:00:00Z')
    expect(isPromotionActiveNow({ days: [] }, now, 'UTC')).toBe(true)
    expect(isPromotionActiveNow({ days: null }, now, 'UTC')).toBe(true)
  })

  it('una franja a medias (solo timeFrom) no restringe, como el backend', () => {
    expect(isPromotionActiveNow({ timeFrom: '18:00' }, new Date('2026-11-25T10:00:00Z'), 'UTC')).toBe(true)
  })

  it('zona inválida no bloquea', () => {
    expect(isPromotionActiveNow({ days: [1] }, new Date(), 'No/Existe')).toBe(true)
  })
})
