import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from './apiClient'
import * as device from './deviceSession'
import * as session from './sessionManager'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
let fetchMock: ReturnType<typeof vi.fn>
let clear: ReturnType<typeof vi.spyOn>
const original = window.location

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  clear = vi.spyOn(session, 'clearSession').mockImplementation(() => {})
  Object.defineProperty(window, 'location', { value: { href: '' }, writable: true, configurable: true })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  Object.defineProperty(window, 'location', { value: original, writable: true, configurable: true })
})

describe('apiFetch: renovación OBLIGATORIA ante 401 (JWT de caja vencido)', () => {
  it('con caja y conexión: renueva y reintenta UNA vez; la venta no se frena', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 401 })).mockResolvedValueOnce(json(200, { success: true, data: { id: 1 } }))
    const renew = vi.spyOn(device, 'renewSession').mockResolvedValue({ ok: true, user: {} as never })
    expect(await apiFetch('/api/sales', { method: 'POST' })).toEqual({ success: true, data: { id: 1 } })
    expect(renew).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(window.location.href).toBe('')
  })

  it('si tras renovar sigue el 401 no entra en bucle: cierra y va al login', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 401 }))
    const renew = vi.spyOn(device, 'renewSession').mockResolvedValue({ ok: true, user: {} as never })
    const r = await apiFetch('/api/sales')
    expect(r.success).toBe(false)
    expect(renew).toHaveBeenCalledTimes(1)
    expect(window.location.href).toBe('/login')
    expect(clear).toHaveBeenCalled()
  })

  it('sin conexión para renovar (UNAVAILABLE): NO cierra la sesión', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 401 }))
    vi.spyOn(device, 'renewSession').mockResolvedValue({ ok: false, code: 'UNAVAILABLE', message: '' })
    const r = await apiFetch('/api/sales')
    expect(r).toMatchObject({ success: false, error: expect.stringMatching(/Sin conexión/) })
    expect(clear).not.toHaveBeenCalled()
    expect(window.location.href).toBe('')
  })

  it('error definitivo (revocada): cierra y vuelve al login con el motivo', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 401 }))
    vi.spyOn(device, 'renewSession').mockResolvedValue({ ok: false, code: 'DEVICE_REVOKED', message: '' })
    await apiFetch('/api/sales')
    expect(clear).toHaveBeenCalled()
    expect(window.location.href).toBe('/login?reason=device-revoked')
  })

  it('sin caja (web, NO_DEVICE): comportamiento de siempre', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 401 }))
    vi.spyOn(device, 'renewSession').mockResolvedValue({ ok: false, code: 'NO_DEVICE', message: '' })
    await apiFetch('/api/products')
    expect(window.location.href).toBe('/login')
  })

  it('un 401 de /api/auth/* (credenciales) no renueva nada', async () => {
    fetchMock.mockResolvedValue(json(401, { success: false, error: 'Credenciales inválidas' }))
    const renew = vi.spyOn(device, 'renewSession')
    expect(await apiFetch('/api/auth/login', { method: 'POST' })).toMatchObject({ success: false, error: 'Credenciales inválidas' })
    expect(renew).not.toHaveBeenCalled()
  })
})
