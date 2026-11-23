import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { STOCK_DEBOUNCE_MS, STOCK_FALLBACK_POLL_MS, useStockSync } from '../useStockSync'

const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

describe('useStockSync', () => {
  let syncStock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    vi.useFakeTimers()
    syncStock = vi.fn(async () => {})
  })
  afterEach(() => vi.useRealTimers())

  it('ráfaga de eventos → una sola llamada tras el debounce', async () => {
    const { result } = renderHook(() => useStockSync({ sseConnected: true, syncStock }))
    act(() => { result.current.requestSync(); result.current.requestSync() })
    await advance(STOCK_DEBOUNCE_MS - 1)
    act(() => result.current.requestSync())
    await advance(STOCK_DEBOUNCE_MS - 1)
    expect(syncStock).not.toHaveBeenCalled()
    await advance(1)
    expect(syncStock).toHaveBeenCalledTimes(1)
  })

  it('con SSE abierto no hay polling ni sincronización inicial', async () => {
    renderHook(() => useStockSync({ sseConnected: true, syncStock }))
    await advance(STOCK_FALLBACK_POLL_MS * 3)
    expect(syncStock).not.toHaveBeenCalled()
  })

  it('sin SSE sincroniza cada 30 s', async () => {
    renderHook(() => useStockSync({ sseConnected: false, syncStock }))
    await advance(STOCK_FALLBACK_POLL_MS - 1)
    expect(syncStock).not.toHaveBeenCalled()
    await advance(1)
    expect(syncStock).toHaveBeenCalledTimes(1)
    await advance(STOCK_FALLBACK_POLL_MS)
    expect(syncStock).toHaveBeenCalledTimes(2)
  })

  it('al reabrirse el SSE sincroniza una vez y deja de hacer polling; la primera apertura no sincroniza', async () => {
    const { rerender } = renderHook(({ c }) => useStockSync({ sseConnected: c, syncStock }), { initialProps: { c: false } })
    rerender({ c: true }) // primera apertura
    await advance(STOCK_DEBOUNCE_MS + STOCK_FALLBACK_POLL_MS)
    expect(syncStock).not.toHaveBeenCalled()
    rerender({ c: false }) // caída
    rerender({ c: true }) // reapertura
    await advance(STOCK_DEBOUNCE_MS)
    expect(syncStock).toHaveBeenCalledTimes(1)
    await advance(STOCK_FALLBACK_POLL_MS * 2)
    expect(syncStock).toHaveBeenCalledTimes(1)
  })

  it('usa siempre el syncStock del último render y limpia timers al desmontar', async () => {
    const second = vi.fn(async () => {})
    const { result, rerender, unmount } = renderHook(({ s }) => useStockSync({ sseConnected: true, syncStock: s }), { initialProps: { s: syncStock } })
    rerender({ s: second })
    act(() => result.current.requestSync())
    await advance(STOCK_DEBOUNCE_MS)
    expect(syncStock).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    act(() => result.current.requestSync())
    unmount()
    await advance(STOCK_DEBOUNCE_MS * 2)
    expect(second).toHaveBeenCalledTimes(1)
  })
})
