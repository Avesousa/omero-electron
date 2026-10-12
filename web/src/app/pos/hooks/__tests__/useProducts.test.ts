import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { transformProduct, useProducts } from '../useProducts'
import * as session from '@/lib/sessionManager'

const API = [
  { id: '1', code: '001', name: 'Coca 2L', sellingPrice: 1000, costPrice: 600, stock: 20, barcode: '7790001000019', saleFormat: 'UNIT' },
  { id: '2', code: '002', name: 'Queso', sellingPrice: 8000, costPrice: 5000, stock: 12.5, barcode: null, saleFormat: 'GRAMS', unitWeightKg: null, scalePlu: 123 },
  { id: '3', code: '003', name: 'Pan', sellingPrice: 4000, costPrice: 2000, stock: 5, barcode: null, saleFormat: 'MIXED', unitWeightKg: 0.25, unitPrice: null, effectiveUnitPrice: 1000, scalePlu: 7 },
]

describe('transformProduct', () => {
  it('producto por unidad: sin datos de peso', () => {
    expect(transformProduct(API[0])).toMatchObject({
      code: '001', price: 1000, stock: 20, saleFormat: 'UNIT', unitWeightKg: null, unitPrice: null, scalePlu: null,
    })
  })

  it('producto por peso: precio y stock por kg, con su código de balanza', () => {
    expect(transformProduct(API[1])).toMatchObject({ price: 8000, stock: 12.5, saleFormat: 'GRAMS', unitPrice: null, scalePlu: 123 })
  })

  it('producto por unidad y peso: el precio por unidad es el que resuelve el backend', () => {
    expect(transformProduct(API[2])).toMatchObject({ saleFormat: 'MIXED', unitWeightKg: 0.25, unitPrice: 1000, scalePlu: 7 })
    expect(transformProduct({ ...API[2], unitPrice: 1200, effectiveUnitPrice: 1200 }).unitPrice).toBe(1200)
  })

  it('sin effectiveUnitPrice (backend anterior) lo calcula con la misma regla', () => {
    const { effectiveUnitPrice: _omit, ...old } = API[2]
    expect(transformProduct(old).unitPrice).toBe(1000) // 4000 × 0,250
    expect(transformProduct({ ...old, unitPrice: 1300 }).unitPrice).toBe(1300)
  })

  it('formato ausente o desconocido (backend anterior, caché vieja) → por unidad', () => {
    const { saleFormat: _omit, ...old } = API[0]
    expect(transformProduct(old).saleFormat).toBe('UNIT')
    expect(transformProduct({ ...API[0], saleFormat: 'Unidades' }).saleFormat).toBe('UNIT')
  })
})

describe('useProducts', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.spyOn(session, 'authHeaders').mockReturnValue({})
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true, data: API }), { status: 200 })))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('busca un producto por su código de balanza (PLU)', async () => {
    const { result } = renderHook(() => useProducts())
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => { await Promise.resolve() })
    expect(result.current.findProductByScalePlu(123)?.code).toBe('002')
    expect(result.current.findProductByScalePlu(7)?.code).toBe('003')
    expect(result.current.findProductByScalePlu(999)).toBeNull()
    expect(result.current.findProductByScalePlu(0)).toBeNull() // un producto sin PLU no coincide con 0
  })
})
