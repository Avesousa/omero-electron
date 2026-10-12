import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useCart } from '../useCart'
import { mixedProduct, unitProduct, weightProduct } from '../../lib/__tests__/fixtures'
import * as session from '@/lib/sessionManager'

const promo = {
  id: 'p1', name: '3 Cocas', type: 'VOLUME', status: 'ACTIVE', minTotalQuantity: 3,
  products: [{ productCode: '001', productName: 'Coca 2L', promotionalPrice: 900, minQuantity: 3 }],
}
let promotions: unknown[]

beforeEach(() => {
  promotions = []
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true, data: promotions }), { status: 200 })))
  vi.spyOn(session, 'authHeaders').mockReturnValue({})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function cart(notify = vi.fn()) {
  const hook = renderHook(() => useCart(notify))
  await act(async () => { await Promise.resolve() }) // promociones cargadas
  return { ...hook, notify }
}

describe('useCart', () => {
  it('las unidades de un mismo producto se acumulan en una línea', async () => {
    const { result, notify } = await cart()
    act(() => result.current.addToCart(unitProduct(), 1))
    act(() => result.current.addToCart(unitProduct(), 2))
    expect(result.current.cart).toHaveLength(1)
    expect(result.current.cart[0]).toMatchObject({ code: '001', quantity: 3, total: 3000, saleUnit: 'UNIT' })
    expect(result.current.total).toBe(3000)
    expect(result.current.itemCount).toBe(1)
    expect(notify).toHaveBeenCalledTimes(2)
  })

  it('cada pesada es una línea propia', async () => {
    const { result } = await cart()
    act(() => result.current.addWeightToCart(weightProduct(), 0.35))
    act(() => result.current.addWeightToCart(weightProduct(), 0.2))
    expect(result.current.cart.map(i => [i.quantity, i.total, i.saleUnit])).toEqual([[0.35, 2800, 'KG'], [0.2, 1600, 'KG']])
    expect(result.current.total).toBe(4400)
  })

  it('un producto mixto puede tener una línea por unidad y pesadas a la vez', async () => {
    const { result } = await cart()
    act(() => result.current.addToCart(mixedProduct(), 2))
    act(() => result.current.addWeightToCart(mixedProduct(), 0.4))
    act(() => result.current.addToCart(mixedProduct(), 1))
    // la pesada queda donde estaba; la línea por unidad se acumula y pasa al final
    expect(result.current.cart.map(i => [i.saleUnit, i.quantity, i.total])).toEqual([['KG', 0.4, 1600], ['UNIT', 3, 3600]])
    expect(result.current.cart[1].stockPerUnit).toBe(0.25)
  })

  it('etiqueta de balanza: se cobra el importe impreso', async () => {
    const { result } = await cart()
    act(() => result.current.addWeightToCart(weightProduct(), 0.525, 4199.9))
    expect(result.current.cart[0]).toMatchObject({ quantity: 0.525, total: 4199.9, fixedTotal: true })
    expect(result.current.total).toBe(4199.9)
  })

  it('corregir el peso recalcula el importe (y deja de ser el de la etiqueta)', async () => {
    const { result } = await cart()
    act(() => result.current.addWeightToCart(weightProduct(), 0.525, 4199.9))
    const lineId = result.current.cart[0].id
    act(() => result.current.updateCartItemWeight(lineId, 0.6))
    expect(result.current.cart[0]).toMatchObject({ quantity: 0.6, total: 4800 })
    expect(result.current.cart[0].fixedTotal).toBeUndefined()
  })

  it('corregir el peso no toca otras líneas ni una línea por unidad', async () => {
    const { result } = await cart()
    act(() => result.current.addToCart(unitProduct(), 2))
    act(() => result.current.addWeightToCart(weightProduct(), 0.3))
    const unitId = result.current.cart[0].id
    act(() => result.current.updateCartItemWeight(unitId, 5))
    act(() => result.current.updateCartItemWeight('no-existe', 5))
    expect(result.current.cart.map(i => i.quantity)).toEqual([2, 0.3])
  })

  it('cambiar la cantidad solo afecta a la línea por unidad', async () => {
    const { result } = await cart()
    act(() => result.current.addWeightToCart(mixedProduct(), 0.4))
    act(() => result.current.updateCartItemQuantity('003', 5)) // no hay línea por unidad: nada cambia
    expect(result.current.cart).toHaveLength(1)
    act(() => result.current.addToCart(mixedProduct(), 1))
    act(() => result.current.updateCartItemQuantity('003', 5))
    expect(result.current.cart.map(i => [i.saleUnit, i.quantity, i.total])).toEqual([['KG', 0.4, 1600], ['UNIT', 5, 6000]])
  })

  it('eliminar y vaciar', async () => {
    const { result, notify } = await cart()
    act(() => result.current.addToCart(unitProduct(), 1))
    act(() => result.current.addWeightToCart(weightProduct(), 0.3))
    let removed = false
    act(() => { removed = result.current.removeFromCart(0) })
    expect(removed).toBe(true)
    expect(result.current.cart.map(i => i.code)).toEqual(['002'])
    act(() => { removed = result.current.removeFromCart(7) })
    expect(removed).toBe(false)
    act(() => result.current.clearCart())
    expect(result.current.cart).toEqual([])
    expect(result.current.total).toBe(0)
    expect(notify).toHaveBeenCalled()
  })

  it('funciona sin notificaciones', async () => {
    const hook = renderHook(() => useCart())
    await act(async () => { await Promise.resolve() })
    act(() => hook.result.current.addToCart(unitProduct(), 1))
    act(() => hook.result.current.addWeightToCart(weightProduct(), 0.1))
    act(() => { hook.result.current.removeFromCart(0) })
    act(() => hook.result.current.clearCart())
    expect(hook.result.current.cart).toEqual([])
  })

  it('el total no arrastra ruido de punto flotante', async () => {
    const { result } = await cart()
    act(() => result.current.addWeightToCart(weightProduct({ price: 0.1 }), 1))
    act(() => result.current.addWeightToCart(weightProduct({ price: 0.2 }), 1))
    expect(result.current.total).toBe(0.3)
  })

  describe('promociones', () => {
    it('una promoción por cantidad aplica a las unidades', async () => {
      promotions = [promo]
      const { result } = await cart()
      act(() => result.current.addToCart(unitProduct(), 3))
      expect(result.current.cart[0]).toMatchObject({ price: 900, total: 2700, promotionId: 'p1' })
    })

    it('el importe de una etiqueta de balanza sobrevive a las promociones de otros productos', async () => {
      promotions = [promo]
      const { result } = await cart()
      act(() => result.current.addWeightToCart(weightProduct(), 0.525, 4199.9))
      act(() => result.current.addToCart(unitProduct(), 3)) // dispara la promo de las Cocas
      const [label, cocas] = result.current.cart
      expect(label).toMatchObject({ saleUnit: 'KG', quantity: 0.525, total: 4199.9, fixedTotal: true })
      expect(cocas).toMatchObject({ price: 900, total: 2700, promotionId: 'p1' })
      expect(result.current.total).toBe(6899.9)
    })

    it('las pesadas no cuentan para una promoción ni reciben su precio', async () => {
      promotions = [{ ...promo, products: [{ productCode: '003', productName: 'Pan', promotionalPrice: 100, minQuantity: 3 }] }]
      const { result } = await cart()
      act(() => result.current.addWeightToCart(mixedProduct(), 3)) // 3 kg no son 3 unidades
      expect(result.current.cart[0]).toMatchObject({ saleUnit: 'KG', price: 4000, total: 12000 })
      expect(result.current.cart[0].promotionId).toBeUndefined()

      act(() => result.current.addToCart(mixedProduct(), 3)) // 3 unidades sí
      const [weight, units] = result.current.cart
      expect(weight).toMatchObject({ saleUnit: 'KG', price: 4000, total: 12000 })
      expect(weight.promotionId).toBeUndefined()
      expect(units).toMatchObject({ saleUnit: 'UNIT', price: 100, total: 300, promotionId: 'p1' })
    })
  })
})
