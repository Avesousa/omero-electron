import { describe, expect, it } from 'vitest'
import cases from '../__fixtures__/promo-cases.json'
import { pickTier } from './tiers'

describe('pickTier (escalones compartidos con backend y admin)', () => {
  it.each(cases.tierCases)('$name', c => {
    const tiers = c.tiers.map(t => ({ minQuantity: t.minQuantity, promotionalPrice: Number(t.price) }))
    const tier = pickTier(tiers, c.quantity)
    expect(tier ? tier.promotionalPrice : Number(c.normalPrice)).toBe(Number(c.expectUnitPrice))
  })
})
