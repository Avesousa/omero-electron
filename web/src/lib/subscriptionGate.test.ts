import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  clearSubscriptionInactive,
  handleSubscriptionResponse,
  isSubscriptionInactiveResponse,
  isSubscriptionMarkedInactive,
  markSubscriptionInactive,
} from './subscriptionGate'
import { useSubscriptionMarkedInactive } from './useEntitlement'
import * as session from './sessionManager'
import { apiFetch } from './apiClient'

afterEach(() => {
  clearSubscriptionInactive()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('manejo del 403 SUBSCRIPTION_INACTIVE', () => {
  it('solo el 403 con ese code cuenta', () => {
    expect(isSubscriptionInactiveResponse(403, { success: false, code: 'SUBSCRIPTION_INACTIVE' })).toBe(true)
    expect(isSubscriptionInactiveResponse(403, { code: 'DEVICE_SCOPE' })).toBe(false)
    expect(isSubscriptionInactiveResponse(403, null)).toBe(false)
    expect(isSubscriptionInactiveResponse(402, { code: 'SUBSCRIPTION_INACTIVE' })).toBe(false)
    expect(isSubscriptionInactiveResponse(200, { code: 'SUBSCRIPTION_INACTIVE' })).toBe(false)
  })

  it('handleSubscriptionResponse abre la compuerta y el hook se entera', () => {
    const { result } = renderHook(() => useSubscriptionMarkedInactive())
    expect(result.current).toBe(false)
    act(() => { handleSubscriptionResponse(403, { code: 'SUBSCRIPTION_INACTIVE' }) })
    expect(result.current).toBe(true)
    act(() => clearSubscriptionInactive())
    expect(result.current).toBe(false)
  })

  it('apiFetch con 403 SUBSCRIPTION_INACTIVE bloquea SIN cerrar sesión ni redirigir', async () => {
    const clear = vi.spyOn(session, 'clearSession').mockImplementation(() => {})
    vi.spyOn(session, 'authHeaders').mockReturnValue({})
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ success: false, error: 'x', code: 'SUBSCRIPTION_INACTIVE' }), { status: 403 })))
    const r = await apiFetch('/api/sales', { method: 'POST' })
    expect(r).toMatchObject({ success: false })
    expect(isSubscriptionMarkedInactive()).toBe(true)
    expect(clear).not.toHaveBeenCalled()
  })

  it('apiFetch con un 403 cualquiera no bloquea', async () => {
    vi.spyOn(session, 'authHeaders').mockReturnValue({})
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false, error: 'no' }), { status: 403 })))
    await apiFetch('/api/x')
    expect(isSubscriptionMarkedInactive()).toBe(false)
  })

  it('mark/clear son idempotentes', () => {
    markSubscriptionInactive(); markSubscriptionInactive()
    expect(isSubscriptionMarkedInactive()).toBe(true)
    clearSubscriptionInactive(); clearSubscriptionInactive()
    expect(isSubscriptionMarkedInactive()).toBe(false)
  })
})
