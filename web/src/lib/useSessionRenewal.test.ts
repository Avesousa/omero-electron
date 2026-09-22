import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { RENEW_BEFORE_MS, RETRY_MS, useSessionRenewal } from './useSessionRenewal'
import * as device from './deviceSession'
import * as session from './sessionManager'

const NOW = Date.parse('2026-02-01T10:00:00Z')
let expSec: number | null
let onLost: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  expSec = Math.floor(NOW / 1000) + 3600
  onLost = vi.fn()
  vi.spyOn(session, 'getSessionExpiry').mockImplementation(() => expSec)
  vi.spyOn(device, 'fetchDeviceInfo').mockResolvedValue({ desktop: true, hasDevice: true, sessionActive: true })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })
const mount = (authenticated = true) => renderHook(() => useSessionRenewal({ authenticated, onSessionLost: onLost as never }))

describe('useSessionRenewal', () => {
  it('no autenticado, web o sin caja: no agenda ni renueva', async () => {
    const renew = vi.spyOn(device, 'renewSession')
    mount(false)
    await flush()
    vi.spyOn(device, 'fetchDeviceInfo').mockResolvedValue({ desktop: false, hasDevice: false, sessionActive: false })
    mount()
    await flush()
    await act(async () => { await vi.advanceTimersByTimeAsync(3 * 3600_000) })
    expect(renew).not.toHaveBeenCalled()
  })

  it('agenda la renovación 5 min antes de que venza y la repite con el JWT nuevo', async () => {
    const renew = vi.spyOn(device, 'renewSession').mockImplementation(async () => {
      expSec = Math.floor(Date.now() / 1000) + 3600 // el JWT nuevo vive 1 h
      return { ok: true, user: {} as never }
    })
    mount()
    await flush()
    await act(async () => { await vi.advanceTimersByTimeAsync(3600_000 - RENEW_BEFORE_MS - 1000) })
    expect(renew).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(renew).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(3600_000 - RENEW_BEFORE_MS) })
    expect(renew).toHaveBeenCalledTimes(2)
    expect(onLost).not.toHaveBeenCalled()
  })

  it('si ya está por vencer (o vencido) al montar, renueva de inmediato', async () => {
    expSec = Math.floor(NOW / 1000) + 60
    const renew = vi.spyOn(device, 'renewSession').mockResolvedValue({ ok: true, user: {} as never })
    mount()
    await flush()
    expect(renew).toHaveBeenCalledTimes(1)
  })

  it.each([['DEVICE_REVOKED', 'device-revoked'], ['DEVICE_EXPIRED', 'device-expired'], ['LOGIN_REQUIRED', 'login-required']] as const)('%s → avisa que la sesión se perdió (%s)', async (code, reason) => {
    expSec = Math.floor(NOW / 1000) + 10
    vi.spyOn(device, 'renewSession').mockResolvedValue({ ok: false, code, message: '' })
    mount()
    await flush()
    expect(onLost).toHaveBeenCalledWith(reason)
  })

  it('sin red (UNAVAILABLE) reintenta al minuto y NO cierra la sesión', async () => {
    expSec = Math.floor(NOW / 1000) + 10
    const renew = vi.spyOn(device, 'renewSession').mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE', message: '' }).mockResolvedValue({ ok: true, user: {} as never })
    mount()
    await flush()
    expect(onLost).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(RETRY_MS) })
    expect(renew).toHaveBeenCalledTimes(2)
  })

  it('al recuperar la red renueva si ya está por vencer; si aún falta mucho, no', async () => {
    const renew = vi.spyOn(device, 'renewSession').mockResolvedValue({ ok: true, user: {} as never })
    mount()
    await flush()
    window.dispatchEvent(new Event('online'))
    await flush()
    expect(renew).not.toHaveBeenCalled()
    expSec = Math.floor(Date.now() / 1000) + 120
    window.dispatchEvent(new Event('online'))
    await flush()
    expect(renew).toHaveBeenCalledTimes(1)
  })

  it('sin sesión guardada no hace nada; al desmontar cancela todo', async () => {
    expSec = null
    const renew = vi.spyOn(device, 'renewSession')
    const { unmount } = mount()
    await flush()
    unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(3 * 3600_000) })
    expect(renew).not.toHaveBeenCalled()
  })

  it('desmontar antes de que responda fetchDeviceInfo no agenda nada', async () => {
    const renew = vi.spyOn(device, 'renewSession').mockResolvedValue({ ok: true, user: {} as never })
    const { unmount } = mount()
    unmount()
    await flush()
    await act(async () => { await vi.advanceTimersByTimeAsync(3600_000) })
    expect(renew).not.toHaveBeenCalled()
  })
})
