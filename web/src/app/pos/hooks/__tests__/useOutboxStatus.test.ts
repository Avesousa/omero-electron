import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { POLL_ACTIVE_MS, POLL_IDLE_MS, useOutboxStatus } from '../useOutboxStatus'
import * as session from '@/lib/sessionManager'

const payload = (pending: number, over: Record<string, unknown> = {}) => ({
  success: true,
  data: { available: true, counts: { pending, sent: 0, review: 1, failed: 0 }, backend: 'offline', nextAttemptAt: null, items: [], ...over },
})
const res = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.useFakeTimers()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(session, 'authHeaders').mockReturnValue({ Authorization: 'Bearer x' })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })

describe('useOutboxStatus', () => {
  it('web / runtime desconocido: inactivo, no consulta nada', async () => {
    const { result, rerender } = renderHook(({ r }) => useOutboxStatus(r), { initialProps: { r: 'web' as 'web' | 'desktop' | null } })
    await flush()
    rerender({ r: null })
    await flush()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.available).toBe(false)
    expect(result.current.counts).toEqual({ pending: 0, sent: 0, review: 0, failed: 0 })
  })

  it('desktop: consulta al montar con el token y expone conteos y estado del envío', async () => {
    fetchMock.mockImplementation(async () => res(payload(2)))
    const { result } = renderHook(() => useOutboxStatus('desktop'))
    await flush()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/_local/outbox?limit=100')
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer x' })
    expect(result.current).toMatchObject({ available: true, backend: 'offline' })
    expect(result.current.counts.pending).toBe(2)
    expect(result.current.counts.review).toBe(1)
  })

  it('consulta seguido con pendientes y despacio en reposo', async () => {
    fetchMock.mockImplementation(async () => res(payload(1)))
    renderHook(() => useOutboxStatus('desktop'))
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_ACTIVE_MS) })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    fetchMock.mockImplementation(async () => res(payload(0)))
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_ACTIVE_MS) })
    const afterIdle = fetchMock.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_ACTIVE_MS) })
    expect(fetchMock.mock.calls.length).toBe(afterIdle) // ahora espera POLL_IDLE_MS
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_IDLE_MS) })
    expect(fetchMock.mock.calls.length).toBeGreaterThan(afterIdle)
  })

  it('si el servidor local no responde conserva lo último conocido', async () => {
    fetchMock.mockImplementationOnce(async () => res(payload(4)))
    const { result } = renderHook(() => useOutboxStatus('desktop'))
    await flush()
    fetchMock.mockRejectedValue(new TypeError('down'))
    await act(async () => { await result.current.refresh() })
    expect(result.current.counts.pending).toBe(4)
  })

  it('refresh() vuelve a consultar; una respuesta sin success se ignora', async () => {
    fetchMock.mockImplementation(async () => res(payload(1)))
    const { result } = renderHook(() => useOutboxStatus('desktop'))
    await flush()
    fetchMock.mockImplementation(async () => res({ success: false }))
    await act(async () => { await result.current.refresh() })
    expect(result.current.counts.pending).toBe(1)
  })

  it('dismiss() llama al endpoint del ítem y refresca', async () => {
    fetchMock.mockImplementation(async (url: string) => (url.includes('/dismiss') ? res({ success: true }) : res(payload(0))))
    const { result } = renderHook(() => useOutboxStatus('desktop'))
    await flush()
    let ok = false
    await act(async () => { ok = await result.current.dismiss('abc/1') })
    expect(ok).toBe(true)
    const dismissCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/dismiss'))!
    expect(dismissCall[0]).toBe('/api/_local/outbox/abc%2F1/dismiss')
    expect((dismissCall[1] as RequestInit).method).toBe('POST')
  })

  it('dismiss() devuelve false si falla la red', async () => {
    fetchMock.mockImplementationOnce(async () => res(payload(0)))
    const { result } = renderHook(() => useOutboxStatus('desktop'))
    await flush()
    fetchMock.mockRejectedValue(new TypeError('x'))
    let ok = true
    await act(async () => { ok = await result.current.dismiss('c') })
    expect(ok).toBe(false)
  })

  it('al volver la red (evento online) consulta de inmediato', async () => {
    fetchMock.mockImplementation(async () => res(payload(0)))
    renderHook(() => useOutboxStatus('desktop'))
    await flush()
    const before = fetchMock.mock.calls.length
    await act(async () => { window.dispatchEvent(new Event('online')); await vi.advanceTimersByTimeAsync(0) })
    expect(fetchMock.mock.calls.length).toBe(before + 1)
  })
})
