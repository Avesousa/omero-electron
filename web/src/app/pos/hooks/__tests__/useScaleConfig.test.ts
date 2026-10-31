import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useScaleConfig } from '../useScaleConfig'
import { DEFAULT_SCALE_CONFIG } from '@/lib/scale'
import * as session from '@/lib/sessionManager'

let values: Record<string, string | null>
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  values = {}
  fetchMock = vi.fn(async (url: string) => {
    const key = decodeURIComponent(String(url).split('/').pop() ?? '')
    if (!(key in values)) return new Response(JSON.stringify({ success: false, error: 'no existe' }), { status: 404 })
    return new Response(JSON.stringify({ success: true, data: { key, value: values[key] } }), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(session, 'authHeaders').mockReturnValue({})
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })

describe('useScaleConfig', () => {
  it('hasta que responde, la balanza está apagada', async () => {
    const { result } = renderHook(() => useScaleConfig())
    expect(result.current).toEqual(DEFAULT_SCALE_CONFIG)
    await flush()
  })

  it('lee las cinco claves del negocio', async () => {
    values = {
      scale_enabled: 'true', scale_brand: 'SYSTEL', scale_barcode_templates: '20PPPPCCCCCC',
      scale_amount_decimals: '0', scale_weight_decimals: '3',
    }
    const { result } = renderHook(() => useScaleConfig())
    await flush()
    expect(fetchMock.mock.calls.map(c => c[0]).sort()).toEqual([
      '/api/business/config/scale_amount_decimals',
      '/api/business/config/scale_barcode_templates',
      '/api/business/config/scale_brand',
      '/api/business/config/scale_enabled',
      '/api/business/config/scale_weight_decimals',
    ])
    expect(result.current).toEqual({
      enabled: true, brand: 'SYSTEL', templates: ['20PPPPCCCCCC'], amountDecimals: 0, weightDecimals: 3,
    })
  })

  it('backend sin las claves (versión vieja): sigue apagada', async () => {
    const { result } = renderHook(() => useScaleConfig())
    await flush()
    expect(result.current.enabled).toBe(false)
  })

  it('solo scale_enabled: el resto toma los valores de fábrica', async () => {
    values = { scale_enabled: 'true' }
    const { result } = renderHook(() => useScaleConfig())
    await flush()
    expect(result.current).toEqual({ ...DEFAULT_SCALE_CONFIG, enabled: true })
  })

  it('ante un error conserva lo último conocido y relee al volver la conexión', async () => {
    values = { scale_enabled: 'true', scale_amount_decimals: '0' }
    const { result, rerender } = renderHook(({ online }) => useScaleConfig({ refreshKey: online }), { initialProps: { online: true } })
    await flush()
    expect(result.current).toMatchObject({ enabled: true, amountDecimals: 0 })

    fetchMock.mockRejectedValue(new TypeError('sin conexión'))
    rerender({ online: false })
    await flush()
    expect(result.current).toMatchObject({ enabled: true, amountDecimals: 0 })
  })

  it('se refresca cada 5 minutos y deja de hacerlo al desmontar', async () => {
    values = { scale_enabled: 'false' }
    const { result, unmount } = renderHook(() => useScaleConfig())
    await flush()
    expect(result.current.enabled).toBe(false)

    values = { scale_enabled: 'true' }
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000) })
    expect(result.current.enabled).toBe(true)

    const calls = fetchMock.mock.calls.length
    unmount()
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(fetchMock.mock.calls.length).toBe(calls)
  })
})
