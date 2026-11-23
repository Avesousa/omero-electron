import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { FULL_FALLBACK_MIN_MS, FULL_RECONCILE_MS, transformProduct, useProducts } from '../useProducts'
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

describe('useProducts.syncStock', () => {
  const full = (etag: string | null = '"3-10"') =>
    new Response(JSON.stringify({ success: true, data: API }), { status: 200, headers: etag ? { ETag: etag } : {} })
  const delta = (version: number, items: { code: string; stock: number }[]) =>
    new Response(JSON.stringify({ success: true, data: { version, items } }), { status: 200 })
  let fetchMock: ReturnType<typeof vi.fn>
  const urls = () => fetchMock.mock.calls.map((c) => String(c[0]))

  const mount = async () => {
    const hook = renderHook(() => useProducts())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    return hook
  }
  const sync = async (hook: Awaited<ReturnType<typeof mount>>) => {
    await act(async () => { await hook.result.current.syncStock() })
  }

  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    vi.spyOn(session, 'authHeaders').mockReturnValue({})
    fetchMock = vi.fn(async () => full())
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('aplica el delta al estado y a localStorage, y avanza la versión', async () => {
    const hook = await mount()
    fetchMock.mockResolvedValueOnce(delta(12, [{ code: '001', stock: 7 }]))
    await sync(hook)
    expect(urls().at(-1)).toBe('/api/products/stock?since=10')
    expect(hook.result.current.products.find((p) => p.code === '001')?.stock).toBe(7)
    expect(JSON.parse(localStorage.getItem('pos_products_cache')!).products[0].stock).toBe(7)
    fetchMock.mockResolvedValueOnce(delta(12, []))
    await sync(hook)
    expect(urls().at(-1)).toBe('/api/products/stock?since=12')
  })

  it('códigos desconocidos se ignoran', async () => {
    const hook = await mount()
    const before = hook.result.current.products
    fetchMock.mockResolvedValueOnce(delta(11, [{ code: 'ZZZ', stock: 1 }]))
    await sync(hook)
    expect(hook.result.current.products).toBe(before)
  })

  it('la versión no retrocede: una versión menor fuerza el catálogo completo', async () => {
    const hook = await mount()
    fetchMock.mockResolvedValueOnce(delta(3, [{ code: '001', stock: 1 }])).mockResolvedValueOnce(full('"3-4"'))
    await sync(hook)
    expect(urls().at(-1)).toBe('/api/products')
    expect(hook.result.current.products.find((p) => p.code === '001')?.stock).toBe(20) // el delta viejo no se aplicó
    fetchMock.mockResolvedValueOnce(delta(5, []))
    await sync(hook)
    expect(urls().at(-1)).toBe('/api/products/stock?since=4') // la carga completa fijó la versión
  })

  it('410 → catálogo completo; el segundo dentro de 5 min se limita', async () => {
    const hook = await mount()
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: false, code: 'STOCK_DELTA_EXPIRED', error: 'x' }), { status: 410 }))
      .mockResolvedValueOnce(full('"3-20"'))
    await sync(hook)
    expect(urls().slice(-2)).toEqual(['/api/products/stock?since=10', '/api/products'])

    // Otra vez 410 (el catálogo completo no trajo versión nueva válida): dentro de los 5 min no se vuelve a bajar.
    fetchMock.mockResolvedValueOnce(new Response('', { status: 410 }))
    const calls = fetchMock.mock.calls.length
    await sync(hook)
    expect(fetchMock.mock.calls.length).toBe(calls + 1) // solo el delta
    await act(async () => { await vi.advanceTimersByTimeAsync(FULL_FALLBACK_MIN_MS) })
    fetchMock.mockResolvedValueOnce(new Response('', { status: 410 })).mockResolvedValueOnce(full('"3-30"'))
    await sync(hook)
    expect(urls().at(-1)).toBe('/api/products')
  })

  it('sin versión (backend viejo sin ETag) → catálogo completo limitado a 1 cada 5 min', async () => {
    fetchMock.mockImplementation(async () => full(null))
    const hook = await mount()
    const base = fetchMock.mock.calls.length
    await sync(hook)
    expect(fetchMock.mock.calls.length).toBe(base + 1)
    await sync(hook)
    expect(fetchMock.mock.calls.length).toBe(base + 1)
    await act(async () => { await vi.advanceTimersByTimeAsync(FULL_FALLBACK_MIN_MS) })
    await sync(hook)
    expect(fetchMock.mock.calls.length).toBe(base + 2)
  })

  it('error de red: no hace nada', async () => {
    const hook = await mount()
    const before = hook.result.current.products
    fetchMock.mockRejectedValueOnce(new TypeError('offline'))
    const calls = fetchMock.mock.calls.length
    await sync(hook)
    expect(fetchMock.mock.calls.length).toBe(calls + 1)
    expect(hook.result.current.products).toBe(before)
  })

  it('payload inválido → catálogo completo', async () => {
    const hook = await mount()
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { version: 'x', items: [] } }), { status: 200 }))
      .mockResolvedValueOnce(full('"3-10"'))
    await sync(hook)
    expect(urls().at(-1)).toBe('/api/products')
  })

  it('reentrancia: una sola ejecución a la vez y una repetición si llegó otro disparo', async () => {
    const hook = await mount()
    let release!: () => void
    fetchMock.mockImplementationOnce(() => new Promise<Response>((r) => { release = () => r(delta(11, [])) }))
    const base = fetchMock.mock.calls.length
    let p1!: Promise<void>
    act(() => { p1 = hook.result.current.syncStock() })
    await act(async () => { await hook.result.current.syncStock(); await hook.result.current.syncStock() }) // mientras corre
    expect(fetchMock.mock.calls.length).toBe(base + 1)
    fetchMock.mockResolvedValueOnce(delta(12, []))
    await act(async () => { release(); await p1 })
    expect(fetchMock.mock.calls.length).toBe(base + 2) // una sola repetición para los dos disparos
    expect(urls().at(-1)).toBe('/api/products/stock?since=11')
  })

  it('reconciliación completa cada 30 min, sin condicional', async () => {
    await mount()
    const base = fetchMock.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(FULL_RECONCILE_MS) })
    expect(fetchMock.mock.calls.length).toBe(base + 1)
    expect(fetchMock.mock.calls.at(-1)![0]).toBe('/api/products')
    expect((fetchMock.mock.calls.at(-1)![1] as RequestInit).cache).toBe('reload')
  })
})
