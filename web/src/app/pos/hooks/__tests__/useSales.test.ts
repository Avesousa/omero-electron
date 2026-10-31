import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { buildSalePayload, useSales } from '../useSales'
import type { CartItem } from '../../types'
import * as session from '@/lib/sessionManager'

const cartItem = (o: Partial<CartItem> = {}): CartItem => ({ id: 'i1', code: '001', name: 'Coca 2L', price: 100, quantity: 2, total: 200, ...o })

describe('buildSalePayload', () => {
  it('incluye productName (snapshot), sin costo, y null en promoción ausente', () => {
    const p = buildSalePayload([cartItem()], 200, 0, 0)
    expect(p).toEqual({
      items: [{ productId: '001', productName: 'Coca 2L', quantity: 2, unitPrice: 100, total: 200, promotionId: null, promotionName: null, saleUnit: 'UNIT', stockQuantity: 2 }],
      cashAmount: 200, mpAmount: 0, change: 0,
    })
    expect(JSON.stringify(p)).not.toMatch(/cost/i)
  })

  it('conserva la promoción aplicada', () => {
    const p = buildSalePayload([cartItem({ promotionId: 'p1', promotionName: '2x1' })], 0, 200, 0)
    expect(p.items[0]).toMatchObject({ promotionId: 'p1', promotionName: '2x1' })
    expect(p.mpAmount).toBe(200)
  })

  it('una pesada viaja en kg con su importe; lo que descuenta de stock son sus kilos', () => {
    const p = buildSalePayload([cartItem({ code: '002', name: 'Queso', price: 8000, quantity: 0.35, total: 2800, saleUnit: 'KG' })], 2800, 0, 0)
    expect(p.items[0]).toMatchObject({ productId: '002', quantity: 0.35, unitPrice: 8000, total: 2800, saleUnit: 'KG', stockQuantity: 0.35 })
  })

  it('etiqueta de balanza: se manda el importe impreso, no peso × precio', () => {
    const p = buildSalePayload([cartItem({ code: '002', price: 8000, quantity: 0.525, total: 4199.9, saleUnit: 'KG', fixedTotal: true })], 4199.9, 0, 0)
    expect(p.items[0]).toMatchObject({ quantity: 0.525, unitPrice: 8000, total: 4199.9, saleUnit: 'KG' })
    expect(p.items[0]).not.toHaveProperty('fixedTotal')
  })

  it('unidades de un producto por unidad y peso: se venden por unidad y descuentan kilos', () => {
    const p = buildSalePayload([cartItem({ code: '003', price: 1200, quantity: 3, total: 3600, saleUnit: 'UNIT', stockPerUnit: 0.25 })], 3600, 0, 0)
    expect(p.items[0]).toMatchObject({ quantity: 3, unitPrice: 1200, total: 3600, saleUnit: 'UNIT', stockQuantity: 0.75 })
    expect(p.items[0]).not.toHaveProperty('stockPerUnit')
  })

  it('agrupa los ítems de precio libre (000-x) en un único ítem 000', () => {
    const p = buildSalePayload(
      [cartItem(), cartItem({ id: 'f1', code: '000-1', name: 'Libre', price: 30, quantity: 1, total: 30 }), cartItem({ id: 'f2', code: '000-2', name: 'Libre', price: 20, quantity: 1, total: 20 })],
      250, 0, 0,
    )
    expect(p.items).toHaveLength(2)
    expect(p.items[1]).toMatchObject({ productId: '000', quantity: 2, unitPrice: 50, total: 50 })
  })
})

describe('useSales', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(session, 'authHeaders').mockReturnValue({})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })
  const res = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

  it('un solo intento: 201 queued:true (desktop) → éxito con queued', async () => {
    fetchMock.mockResolvedValueOnce(res({ success: true, data: { id: null, queued: true, clientId: 'c' } }, 201))
    const { result } = renderHook(() => useSales())
    let out!: Awaited<ReturnType<typeof result.current.createSale>>
    await act(async () => {
      out = await result.current.createSale([cartItem()], 200, 0, 0)
    })
    expect(out).toMatchObject({ success: true, queued: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/sales')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).items[0].productName).toBe('Coca 2L')
    expect(result.current.isProcessing).toBe(false)
  })

  it('web: respuesta normal → éxito sin queued', async () => {
    fetchMock.mockResolvedValueOnce(res({ success: true, data: { id: 5 } }, 201))
    const { result } = renderHook(() => useSales())
    let out!: Awaited<ReturnType<typeof result.current.createSale>>
    await act(async () => {
      out = await result.current.createSale([cartItem()])
    })
    expect(out).toMatchObject({ success: true, queued: false })
  })

  it('error del servidor → error visible, sin reintentos ni cola', async () => {
    fetchMock.mockResolvedValueOnce(res({ success: false, error: 'Stock inválido' }, 400))
    const { result } = renderHook(() => useSales())
    let out!: Awaited<ReturnType<typeof result.current.createSale>>
    await act(async () => {
      out = await result.current.createSale([cartItem()])
    })
    expect(out).toEqual({ success: false, error: 'Stock inválido' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('omero_purchase_queue')).toBeNull()
  })

  it('fetch lanza (sin conexión, web) → error, nada se encola', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const { result } = renderHook(() => useSales())
    let out!: Awaited<ReturnType<typeof result.current.createSale>>
    await act(async () => {
      out = await result.current.createSale([cartItem()])
    })
    expect(out.success).toBe(false)
    expect(localStorage.getItem('omero_purchase_queue')).toBeNull()
  })
})
