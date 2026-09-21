import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { isTruthyConfig, useBusinessFlag } from '../useBusinessConfig'
import * as session from '@/lib/sessionManager'

const cfg = (value: string | null) => new Response(JSON.stringify({ success: true, data: { key: 'mp_offline', value } }), { status: 200 })

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.useFakeTimers()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(session, 'authHeaders').mockReturnValue({})
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })

describe('isTruthyConfig', () => {
  it.each([['true', true], [' TRUE ', true], ['false', false], ['', false], [null, false], [undefined, false], ['1', false]])('%j → %s', (v, expected) => {
    expect(isTruthyConfig(v as string | null)).toBe(expected)
  })
})

describe('useBusinessFlag', () => {
  it('lee la clave del negocio y devuelve su valor', async () => {
    fetchMock.mockImplementation(async () => cfg('true'))
    const { result } = renderHook(() => useBusinessFlag('mp_offline'))
    expect(result.current).toBe(false) // hasta que responde: lo más restrictivo
    await flush()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/business/config/mp_offline')
    expect(result.current).toBe(true)
  })

  it('deshabilitado: no consulta', async () => {
    renderHook(() => useBusinessFlag('mp_offline', { enabled: false }))
    await flush()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ante un error conserva el último valor conocido', async () => {
    fetchMock.mockImplementationOnce(async () => cfg('true'))
    const { result, rerender } = renderHook(({ k }) => useBusinessFlag('mp_offline', { refreshKey: k }), { initialProps: { k: 1 } })
    await flush()
    expect(result.current).toBe(true)
    fetchMock.mockRejectedValue(new TypeError('offline'))
    rerender({ k: 2 })
    await flush()
    expect(result.current).toBe(true)
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ success: false, error: 'x' }), { status: 500 }))
    rerender({ k: 3 })
    await flush()
    expect(result.current).toBe(true)
  })

  it('cambia cuando el backend lo cambia (refreshKey) y se refresca cada 5 min', async () => {
    fetchMock.mockImplementation(async () => cfg('false'))
    const { result, rerender } = renderHook(({ k }) => useBusinessFlag('mp_offline', { refreshKey: k }), { initialProps: { k: true } })
    await flush()
    expect(result.current).toBe(false)
    fetchMock.mockImplementation(async () => cfg('true'))
    rerender({ k: false })
    await flush()
    expect(result.current).toBe(true)
    const calls = fetchMock.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000) })
    expect(fetchMock.mock.calls.length).toBeGreaterThan(calls)
  })
})
