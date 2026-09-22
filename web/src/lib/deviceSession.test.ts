import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deviceLogout, dropSession, fetchDeviceInfo, loginReasonMessage, reasonFor, renewSession } from './deviceSession'
import * as session from './sessionManager'

const user = { id: 'u', name: 'Ana', email: 'a@x.com', role: 'ADMIN', tenantId: 't' }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  sessionStorage.clear()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(session, 'getAuthToken').mockReturnValue(null)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('reasonFor / loginReasonMessage', () => {
  it.each([['DEVICE_REVOKED', 'device-revoked'], ['DEVICE_EXPIRED', 'device-expired'], ['LOGIN_REQUIRED', 'login-required']] as const)('%s → %s', (code, reason) => {
    expect(reasonFor(code)).toBe(reason)
    expect(loginReasonMessage(reason)).toBeTruthy()
  })
  it('códigos sin motivo de login (reintentables) → null; motivos desconocidos → sin mensaje', () => {
    expect(reasonFor('UNAVAILABLE')).toBeNull()
    expect(reasonFor('NO_DEVICE')).toBeNull()
    expect(loginReasonMessage('otro')).toBeNull()
    expect(loginReasonMessage(null)).toBeNull()
  })
  it('el mensaje de revocada explica que sí puede subir lo pendiente', () => {
    expect(loginReasonMessage('device-revoked')).toMatch(/revocada/)
    expect(loginReasonMessage('device-revoked')).toMatch(/pendiente/)
  })
})

describe('fetchDeviceInfo', () => {
  it('devuelve el estado de la caja (sin secreto) y manda el JWT como pista si hay', async () => {
    vi.spyOn(session, 'getAuthToken').mockReturnValue('JWT')
    fetchMock.mockResolvedValue(json(200, { success: true, data: { desktop: true, hasDevice: true, sessionActive: true } }))
    expect(await fetchDeviceInfo()).toEqual({ desktop: true, hasDevice: true, sessionActive: true })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/_local/session')
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toEqual({ Authorization: 'Bearer JWT' })
  })
  it.each([[{ success: false }], [{ success: true }], ['no json']])('respuesta inválida (%j) o error de red → sin caja', async (body) => {
    fetchMock.mockResolvedValue(typeof body === 'string' ? new Response(body) : json(200, body))
    expect(await fetchDeviceInfo()).toEqual({ desktop: false, hasDevice: false, sessionActive: false })
    fetchMock.mockRejectedValue(new TypeError('x'))
    expect(await fetchDeviceInfo()).toEqual({ desktop: false, hasDevice: false, sessionActive: false })
  })
})

describe('renewSession', () => {
  it('éxito: deja el JWT como sesión actual y devuelve el usuario', async () => {
    const setSpy = vi.spyOn(session, 'setSession').mockImplementation(() => {})
    fetchMock.mockResolvedValue(json(200, { success: true, data: { accessToken: 'JWT2', expiresIn: 3600, user } }))
    expect(await renewSession()).toEqual({ ok: true, user })
    expect(setSpy).toHaveBeenCalledWith('JWT2', user)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/_local/session/refresh')
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('POST')
  })

  it('manda el JWT vencido de sessionStorage solo como pista del tenant', async () => {
    sessionStorage.setItem('omero_auth_token', 'VENCIDO')
    fetchMock.mockResolvedValue(json(401, { success: false, error: 'x', code: 'LOGIN_REQUIRED' }))
    await renewSession()
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toEqual({ Authorization: 'Bearer VENCIDO' })
  })

  it.each([[403, 'DEVICE_REVOKED'], [401, 'DEVICE_EXPIRED'], [401, 'LOGIN_REQUIRED'], [503, 'UNAVAILABLE']])('%i %s → falla tipada', async (status, code) => {
    fetchMock.mockResolvedValue(json(status, { success: false, error: 'msg', code }))
    expect(await renewSession()).toEqual({ ok: false, code, message: 'msg' })
  })

  it('sin red / cuerpo inválido / sin code → UNAVAILABLE', async () => {
    fetchMock.mockRejectedValue(new TypeError('x'))
    expect(await renewSession()).toMatchObject({ ok: false, code: 'UNAVAILABLE' })
    fetchMock.mockResolvedValue(new Response('no json', { status: 200 }))
    expect(await renewSession()).toMatchObject({ code: 'UNAVAILABLE' })
    fetchMock.mockResolvedValue(json(200, { success: true, data: { accessToken: 'x' } }))
    expect(await renewSession()).toMatchObject({ code: 'UNAVAILABLE' })
  })
})

describe('deviceLogout / dropSession', () => {
  it('DELETE al servidor local con keepalive; nunca lanza', () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    deviceLogout()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/_local/session')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'DELETE', keepalive: true })
    fetchMock.mockRejectedValue(new Error('x'))
    expect(() => deviceLogout()).not.toThrow()
    vi.spyOn(session, 'getAuthToken').mockImplementation(() => {
      throw new Error('boom')
    })
    expect(() => deviceLogout()).not.toThrow()
  })
  it('dropSession limpia la sesión', () => {
    const clear = vi.spyOn(session, 'clearSession').mockImplementation(() => {})
    dropSession()
    expect(clear).toHaveBeenCalled()
  })
})
