import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useSessionRenewal } from './useSessionRenewal'
import * as device from './deviceSession'
import * as session from './sessionManager'

const NOW = Date.parse('2026-02-01T10:00:00Z')
let expSec: number | null
let onLost: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  expSec = Math.floor(NOW / 1000) + 26 * 3600 // JWT de caja de 26 h
  onLost = vi.fn()
  vi.spyOn(session, 'getSessionExpiry').mockImplementation(() => expSec)
  vi.spyOn(device, 'fetchDeviceInfo').mockResolvedValue({ desktop: true, hasDevice: true, sessionActive: true, endedReason: null })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })
const mount = (authenticated = true) => renderHook(() => useSessionRenewal({ authenticated, onSessionLost: onLost as never }))

describe('useSessionRenewal (sin relojes: solo reacciona a eventos)', () => {
  it('no autenticado, web o sin caja: no renueva ni corta', async () => {
    const renew = vi.spyOn(device, 'renewSession')
    mount(false)
    await flush()
    vi.spyOn(device, 'fetchDeviceInfo').mockResolvedValue({ desktop: false, hasDevice: false, sessionActive: false })
    expSec = Math.floor(NOW / 1000) - 10
    mount()
    await flush()
    expect(renew).not.toHaveBeenCalled()
    expect(onLost).not.toHaveBeenCalled()
  })

  it('JWT vigente: no renueva nada, ni al montar ni con el paso del tiempo (nada corre por reloj)', async () => {
    const renew = vi.spyOn(device, 'renewSession')
    const info = vi.spyOn(device, 'fetchDeviceInfo')
    mount()
    await flush()
    const calls = info.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(20 * 3600_000) })
    expect(renew).not.toHaveBeenCalled()
    expect(info.mock.calls.length).toBe(calls)
    expect(onLost).not.toHaveBeenCalled()
  })

  it('JWT vencido al montar: renovación obligatoria (obtener credencial)', async () => {
    expSec = Math.floor(NOW / 1000) - 60
    const renew = vi.spyOn(device, 'renewSession').mockResolvedValue({ ok: true, user: {} as never })
    mount()
    await flush()
    expect(renew).toHaveBeenCalledTimes(1)
    expect(onLost).not.toHaveBeenCalled()
  })

  it('al volver la conexión / la pestaña con el JWT vencido renueva; con JWT vigente no', async () => {
    const renew = vi.spyOn(device, 'renewSession').mockResolvedValue({ ok: true, user: {} as never })
    mount()
    await flush()
    window.dispatchEvent(new Event('online'))
    await flush()
    expect(renew).not.toHaveBeenCalled()
    expSec = Math.floor(Date.now() / 1000) - 1
    window.dispatchEvent(new Event('online'))
    await flush()
    expect(renew).toHaveBeenCalledTimes(1)
    document.dispatchEvent(new Event('visibilitychange'))
    await flush()
    expect(renew).toHaveBeenCalledTimes(2)
  })

  it('pestaña oculta: no hace nada', async () => {
    const renew = vi.spyOn(device, 'renewSession').mockResolvedValue({ ok: true, user: {} as never })
    mount()
    await flush()
    expSec = Math.floor(Date.now() / 1000) - 1
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    await flush()
    Object.defineProperty(document, 'hidden', { value: false, configurable: true })
    expect(renew).not.toHaveBeenCalled()
  })

  it.each([['DEVICE_REVOKED', 'device-revoked'], ['DEVICE_EXPIRED', 'device-expired'], ['LOGIN_REQUIRED', 'login-required']] as const)('renovación obligatoria con %s → sesión perdida (%s)', async (code, reason) => {
    expSec = Math.floor(NOW / 1000) - 10
    vi.spyOn(device, 'renewSession').mockResolvedValue({ ok: false, code, message: '' })
    mount()
    await flush()
    expect(onLost).toHaveBeenCalledWith(reason)
  })

  it('sin red (UNAVAILABLE): NO corta la sesión y NO reintenta por reloj; reintenta al volver la conexión', async () => {
    expSec = Math.floor(NOW / 1000) - 10
    const renew = vi.spyOn(device, 'renewSession').mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE', message: '' }).mockResolvedValue({ ok: true, user: {} as never })
    mount()
    await flush()
    await act(async () => { await vi.advanceTimersByTimeAsync(3600_000) })
    expect(renew).toHaveBeenCalledTimes(1)
    expect(onLost).not.toHaveBeenCalled()
    window.dispatchEvent(new Event('online'))
    await flush()
    expect(renew).toHaveBeenCalledTimes(2)
  })

  it('el servidor local ya sabe que la caja terminó (revocada / 14 días sin conectarse): corta con el motivo, sin renovar', async () => {
    vi.spyOn(device, 'fetchDeviceInfo').mockResolvedValue({ desktop: true, hasDevice: true, sessionActive: true, endedReason: 'DEVICE_EXPIRED' })
    const renew = vi.spyOn(device, 'renewSession')
    mount()
    await flush()
    expect(onLost).toHaveBeenCalledWith('device-expired')
    expect(renew).not.toHaveBeenCalled()
  })

  it('sin sesión guardada no hace nada; al desmontar deja de escuchar', async () => {
    expSec = null
    const renew = vi.spyOn(device, 'renewSession')
    const { unmount } = mount()
    await flush()
    unmount()
    expSec = Math.floor(NOW / 1000) - 10
    window.dispatchEvent(new Event('online'))
    await flush()
    expect(renew).not.toHaveBeenCalled()
  })

  it('desmontar antes de que responda fetchDeviceInfo no renueva', async () => {
    expSec = Math.floor(NOW / 1000) - 10
    const renew = vi.spyOn(device, 'renewSession').mockResolvedValue({ ok: true, user: {} as never })
    const { unmount } = mount()
    unmount()
    await flush()
    expect(renew).not.toHaveBeenCalled()
  })
})
