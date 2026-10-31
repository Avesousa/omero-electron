import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const authHeaders = vi.fn(() => ({ Authorization: 'Bearer tok' }))
vi.mock('@/lib/sessionManager', () => ({ authHeaders: () => authHeaders() }))

import { useConnectionStatus, type ConnectivityInfo } from './useConnectionStatus'

const info = (over: Partial<ConnectivityInfo> = {}): ConnectivityInfo => ({
  online: true,
  checkedAt: '2026-01-01T10:00:00Z',
  latencyMs: 12,
  runtime: 'desktop',
  cache: { lastSyncAt: '2026-01-01T09:55:00Z', ageSeconds: 300, products: 25, promotions: 2 },
  ...over,
})

let fetchMock: ReturnType<typeof vi.fn>
const respond = (body: ConnectivityInfo) => fetchMock.mockImplementation(async () => new Response(JSON.stringify(body)))

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock = vi.fn()
  respond(info())
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function mount(pollMs?: number) {
  const hook = renderHook(() => useConnectionStatus(pollMs))
  await act(async () => {}) // deja resolver el chequeo inicial
  return hook
}

describe('useConnectionStatus', () => {
  it('runtime null hasta la primera respuesta; luego refleja el estado del servidor local', async () => {
    let resolve!: (r: Response) => void
    fetchMock.mockImplementation(() => new Promise<Response>((r) => (resolve = r)))
    const { result } = renderHook(() => useConnectionStatus())
    expect(result.current.runtime).toBeNull()
    expect(result.current.online).toBe(true) // sin dato no se alarma
    await act(async () => resolve(new Response(JSON.stringify(info({ online: false })))))
    expect(result.current).toMatchObject({ runtime: 'desktop', online: false, checking: false })
    expect(result.current.cache?.products).toBe(25)
    expect(result.current.lastCheckedAt).toBe('2026-01-01T10:00:00Z')
  })

  it('consulta /api/_local/connectivity con el Authorization de la sesión, sin caché HTTP', async () => {
    await mount()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/_local/connectivity',
      expect.objectContaining({ headers: { Authorization: 'Bearer tok' }, cache: 'no-store' }),
    )
  })

  it('vuelve a consultar cada 30 s', async () => {
    await mount()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('no consulta mientras la pestaña está oculta', async () => {
    await mount()
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    Object.defineProperty(document, 'hidden', { value: false, configurable: true })
  })

  it('los eventos online/offline del navegador disparan un chequeo inmediato', async () => {
    await mount()
    await act(async () => { window.dispatchEvent(new Event('offline')) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await act(async () => { window.dispatchEvent(new Event('online')) })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('check() manual: marca checking y actualiza el estado; SOLO llama al endpoint de conectividad', async () => {
    const { result } = await mount()
    respond(info({ online: false }))
    let promise!: Promise<void>
    act(() => { promise = result.current.check() })
    expect(result.current.checking).toBe(true)
    await act(async () => { await promise })
    expect(result.current.checking).toBe(false)
    expect(result.current.online).toBe(false)
    const urls = fetchMock.mock.calls.map((c) => c[0])
    expect(new Set(urls)).toEqual(new Set(['/api/_local/connectivity'])) // nada más
  })

  it('no superpone chequeos: un check() en curso ignora al siguiente', async () => {
    let resolve!: (r: Response) => void
    fetchMock.mockImplementation(() => new Promise<Response>((r) => (resolve = r)))
    const { result } = renderHook(() => useConnectionStatus())
    await act(async () => { void result.current.check(); void result.current.check() })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => resolve(new Response(JSON.stringify(info()))))
  })

  it('si el servidor local no responde: online=false, y sin dato previo se asume runtime web', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))
    const { result } = await mount()
    expect(result.current.online).toBe(false)
    expect(result.current.runtime).toBe('web')
    expect(result.current.cache).toBeNull()
  })

  it('si falla después de una respuesta buena, conserva runtime y caché previos', async () => {
    const { result } = await mount()
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))
    await act(async () => { await result.current.check() })
    expect(result.current).toMatchObject({ online: false, runtime: 'desktop' })
    expect(result.current.cache?.products).toBe(25)
  })

  it('un chequeo que excede el timeout se aborta (no queda colgado)', async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('abort', 'AbortError')))),
    )
    const { result } = renderHook(() => useConnectionStatus())
    await act(async () => { await vi.advanceTimersByTimeAsync(8_001) })
    expect(result.current.checking).toBe(false)
    expect(result.current.online).toBe(false)
  })

  it('al desmontar limpia el intervalo y los listeners (no hay más requests)', async () => {
    const { unmount } = await mount()
    unmount()
    fetchMock.mockClear()
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); window.dispatchEvent(new Event('online')) })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('pollMs configurable', async () => {
    await mount(5_000)
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
