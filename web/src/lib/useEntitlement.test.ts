import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { ENTITLEMENT_BLOCKED_REFRESH_MS, ENTITLEMENT_REFRESH_MS, fetchEntitlement, useEntitlement } from './useEntitlement'
import { clearSubscriptionInactive, isSubscriptionMarkedInactive, markSubscriptionInactive } from './subscriptionGate'
import * as session from './sessionManager'

const NOW = Date.parse('2026-10-10T12:00:00Z')
const data = (over: Record<string, unknown> = {}) => ({
  status: 'ACTIVE', accessGranted: true, accessUntil: null, trialEndsAt: null, graceUntil: null, planCode: 'PRO',
  courtesy: false, enforced: true, canManage: false, ...over,
})
let current: { body: unknown; cache?: string; status?: number } | 'throw'
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  vi.spyOn(session, 'authHeaders').mockReturnValue({ Authorization: 'Bearer x' })
  current = { body: { success: true, data: data() } }
  fetchMock = vi.fn(async () => {
    if (current === 'throw') throw new TypeError('offline')
    return new Response(JSON.stringify(current.body), {
      status: current.status ?? 200,
      headers: current.cache ? { 'X-Omero-Cache': 'hit', 'X-Omero-Cache-At': current.cache } : {},
    })
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  clearSubscriptionInactive()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

describe('fetchEntitlement', () => {
  it('en vivo: fetchedAt = ahora, fromCache=false', async () => {
    const r = await fetchEntitlement()
    expect(r).toMatchObject({ fromCache: false, fetchedAt: new Date(NOW).toISOString() })
    expect(fetchMock).toHaveBeenCalledWith('/api/billing/entitlement', expect.objectContaining({ headers: { Authorization: 'Bearer x' } }))
  })
  it('desde caché local: usa X-Omero-Cache-At', async () => {
    current = { body: { success: true, data: data() }, cache: '2026-10-09T00:00:00.000Z' }
    expect(await fetchEntitlement()).toMatchObject({ fromCache: true, fetchedAt: '2026-10-09T00:00:00.000Z' })
  })
  it('error de red, no-2xx o forma inválida → null', async () => {
    current = 'throw'
    expect(await fetchEntitlement()).toBeNull()
    current = { body: {}, status: 500 }
    expect(await fetchEntitlement()).toBeNull()
    current = { body: { success: true, data: { x: 1 } } }
    expect(await fetchEntitlement()).toBeNull()
  })
})

describe('useEntitlement', () => {
  it('consulta al montar y cada 5 min', async () => {
    renderHook(() => useEntitlement({ authenticated: true }))
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await advance(ENTITLEMENT_REFRESH_MS)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('no consulta sin sesión', async () => {
    renderHook(() => useEntitlement({ authenticated: false }))
    await advance(ENTITLEMENT_REFRESH_MS * 2)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('consulta al volver la conexión', async () => {
    renderHook(() => useEntitlement({ authenticated: true }))
    await flush()
    await act(async () => { window.dispatchEvent(new Event('online')) })
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('con acceso no bloquea', async () => {
    const { result } = renderHook(() => useEntitlement({ authenticated: true }))
    await flush()
    expect(result.current.blocked).toBe(false)
    expect(result.current.entitlement?.status).toBe('ACTIVE')
    expect(result.current.fetchedAt).toBe(new Date(NOW).toISOString())
  })

  it('sin acceso (según el entitlement) bloquea y sigue consultando cada 30 s hasta que vuelve', async () => {
    current = { body: { success: true, data: data({ accessGranted: false, status: 'EXPIRED' }) } }
    const { result } = renderHook(() => useEntitlement({ authenticated: true }))
    await flush()
    expect(result.current.blocked).toBe(true)

    current = { body: { success: true, data: data() } } // el admin pagó
    await advance(ENTITLEMENT_BLOCKED_REFRESH_MS)
    expect(result.current.blocked).toBe(false) // desbloqueo automático
  })

  it('offline: al pasar accessUntil (con el reloj) se bloquea aunque no haya red', async () => {
    current = { body: { success: true, data: data({ accessUntil: new Date(NOW + 60_000).toISOString() }) }, cache: new Date(NOW).toISOString() }
    const { result } = renderHook(() => useEntitlement({ authenticated: true }))
    await flush()
    expect(result.current.blocked).toBe(false)
    current = 'throw'
    await advance(90_000)
    expect(result.current.blocked).toBe(true)
  })

  it('403 SUBSCRIPTION_INACTIVE (compuerta) bloquea y una consulta EN VIVO con acceso la baja', async () => {
    const { result } = renderHook(() => useEntitlement({ authenticated: true }))
    await flush()
    act(() => markSubscriptionInactive())
    expect(result.current.blocked).toBe(true)
    await advance(ENTITLEMENT_BLOCKED_REFRESH_MS)
    expect(result.current.blocked).toBe(false)
    expect(isSubscriptionMarkedInactive()).toBe(false)
  })

  it('una respuesta de CACHÉ local con acceso no baja la compuerta del 403', async () => {
    current = { body: { success: true, data: data() }, cache: new Date(NOW).toISOString() }
    const { result } = renderHook(() => useEntitlement({ authenticated: true }))
    await flush()
    act(() => markSubscriptionInactive())
    await advance(ENTITLEMENT_BLOCKED_REFRESH_MS)
    expect(result.current.blocked).toBe(true)
  })

  it('si la consulta falla conserva el último estado', async () => {
    const { result } = renderHook(() => useEntitlement({ authenticated: true }))
    await flush()
    current = 'throw'
    await act(async () => { await result.current.refresh() })
    expect(result.current.entitlement?.status).toBe('ACTIVE')
  })
})
