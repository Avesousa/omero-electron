import { useState, useEffect, useCallback } from 'react'
import type { CartItem } from '../types'
import { apiFetch } from '@/lib/apiClient'
import { lineTotal } from '@/lib/quantity'
import { isWeightLine } from '../lib/cartLines'
import { getTenantTimeZone } from '@/lib/tenantTime'
import { isPromotionActiveNow, type PromotionSchedule } from '@/lib/promotions/schedule'
import { pickTier } from '@/lib/promotions/tiers'

interface PromotionProduct {
  productCode: string
  productName: string
  promotionalPrice: number
  minQuantity: number
  variantGroupTag?: string | null
  normalPrice?: number | null
  costPrice?: number | null
}

interface Promotion extends PromotionSchedule {
  id: string
  name: string
  type: 'ASSOCIATION' | 'ASSOCIATION_VOLUME' | 'VOLUME' | 'VOLUME_ASSOCIATION'
  status: 'ACTIVE' | 'PAUSED' | 'FINISHED'
  minTotalQuantity?: number
  products: PromotionProduct[]
}

export const usePromotions = () => {
  const [promotions, setPromotions] = useState<Promotion[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchPromotions()
  }, [])

  const fetchPromotions = async () => {
    try {
      setLoading(true)
      const result = await apiFetch<Promotion[]>('/api/promotions')
      if (result.success) {
        setPromotions(result.data.filter((p: Promotion) => p.status === 'ACTIVE'))
      }
    } catch (error) {
      console.error('Error fetching promotions:', error)
    } finally {
      setLoading(false)
    }
  }

  const detectApplicablePromotions = useCallback((fullCart: CartItem[]): Promotion[] => {
    const applicablePromotions: Promotion[] = []
    // Las promociones se activan por cantidad de unidades: una pesada (línea por kg) no cuenta.
    const cart = fullCart.filter(item => !isWeightLine(item))

    const now = new Date()
    const timeZone = getTenantTimeZone()

    for (const promotion of promotions) {
      if (promotion.status !== 'ACTIVE') continue
      // Vigencia (fechas, días, horario): se evalúa en cada cálculo, con la hora del negocio.
      if (!isPromotionActiveNow(promotion, now, timeZone)) continue

      let isApplicable = false

      switch (promotion.type) {
        case 'ASSOCIATION':
        case 'ASSOCIATION_VOLUME': {
          // Group products by variantGroupTag. Products without tag form their own individual slot.
          // Each slot is satisfied if ANY product from that slot is in the cart with enough quantity.
          const slots = buildSlots(promotion.products)
          isApplicable = slots.every(slot =>
            slot.some(pp => {
              const cartItem = cart.find(item => item.code === pp.productCode)
              return cartItem !== undefined && cartItem.quantity >= pp.minQuantity
            })
          )
          break
        }

        case 'VOLUME':
          // Each product is evaluated independently — promo applies to those that meet threshold
          isApplicable = promotion.products.some(pp => {
            const cartItem = cart.find(item => item.code === pp.productCode)
            return cartItem !== undefined && cartItem.quantity >= pp.minQuantity
          })
          break

        case 'VOLUME_ASSOCIATION':
          // Sum of quantities across all products in promo >= minTotalQuantity
          if (promotion.minTotalQuantity) {
            const totalQuantity = promotion.products.reduce((sum, pp) => {
              const cartItem = cart.find(item => item.code === pp.productCode)
              return sum + (cartItem ? cartItem.quantity : 0)
            }, 0)
            isApplicable = totalQuantity >= promotion.minTotalQuantity
          }
          break
      }

      if (isApplicable) {
        applicablePromotions.push(promotion)
      }
    }

    return applicablePromotions
  }, [promotions])

  const applyPromotions = useCallback((fullCart: CartItem[]): CartItem[] => {
    const applicablePromotions = detectApplicablePromotions(fullCart)
    const cart = fullCart.filter(item => !isWeightLine(item))

    // productCode → { promotionId, promotionName, promotionalPrice }
    // If a product appears in multiple applicable promos, the first one wins
    const promoMap = new Map<string, { id: string; name: string; price: number }>()

    for (const promotion of applicablePromotions) {
      // VOLUME con escalones: el producto se repite con distinto minQuantity; rige el más alto alcanzado.
      const volumeTiers = promotion.type === 'VOLUME' ? groupTiers(promotion.products) : null
      for (const pp of promotion.products) {
        if (volumeTiers) {
          const cartItem = cart.find(item => item.code === pp.productCode)
          const tier = cartItem ? pickTier(volumeTiers.get(pp.productCode) ?? [], cartItem.quantity) : null
          if (!tier) continue
          if (!promoMap.has(pp.productCode)) {
            promoMap.set(pp.productCode, { id: promotion.id, name: promotion.name, price: tier.promotionalPrice })
          }
          continue
        }

        if (!promoMap.has(pp.productCode)) {
          promoMap.set(pp.productCode, {
            id: promotion.id,
            name: promotion.name,
            price: pp.promotionalPrice
          })
        }
      }
    }

    return fullCart.map(item => {
      // Una pesada queda tal cual: ni precio promocional ni recálculo del importe (puede venir de la etiqueta).
      if (isWeightLine(item)) return item

      const originalPrice = item.originalPrice || item.price
      const promo = promoMap.get(item.code)

      if (promo) {
        return {
          ...item,
          originalPrice,
          price: promo.price,
          total: lineTotal(item.quantity, promo.price),
          promotionId: promo.id,
          promotionName: promo.name
        }
      }

      return {
        ...item,
        originalPrice,
        price: originalPrice,
        total: lineTotal(item.quantity, originalPrice),
        promotionId: undefined,
        promotionName: undefined
      }
    })
  }, [promotions])

  return {
    promotions,
    loading,
    fetchPromotions,
    detectApplicablePromotions,
    applyPromotions
  }
}

function groupTiers(products: PromotionProduct[]): Map<string, PromotionProduct[]> {
  const map = new Map<string, PromotionProduct[]>()
  for (const pp of products) {
    const list = map.get(pp.productCode) ?? []
    list.push(pp)
    map.set(pp.productCode, list)
  }
  return map
}

/**
 * Groups promotion products into slots for ASSOCIATION evaluation.
 * Products sharing a variantGroupTag form one slot (any one satisfies it).
 * Products without a tag each form their own individual slot.
 */
function buildSlots(products: PromotionProduct[]): PromotionProduct[][] {
  const tagMap = new Map<string, PromotionProduct[]>()
  const individual: PromotionProduct[][] = []

  for (const pp of products) {
    if (pp.variantGroupTag) {
      const group = tagMap.get(pp.variantGroupTag) ?? []
      group.push(pp)
      tagMap.set(pp.variantGroupTag, group)
    } else {
      individual.push([pp])
    }
  }

  return [...individual, ...Array.from(tagMap.values())]
}
