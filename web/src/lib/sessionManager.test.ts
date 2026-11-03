import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearSession,
  deviceSessionUntil,
  getAuthToken,
  getSessionExpiry,
  getSessionUser,
  setDeviceSessionUntil,
  setSession,
} from './sessionManager'

const user = { id: 'u', name: 'Ana', email: 'a@x.com', role: 'omero-admin', tenantId: 't', permissions: ['VENTAS_VER'] }

function jwt(expOffset: number): string {
  const payload = btoa(JSON.stringify({ sub: 'a@x.com', exp: Math.floor(Date.now() / 1000) + expOffset }))
  return `h.${payload}.s`
}

function cookie(name: string): string | null {
  const m = document.cookie.split('; ').find(c => c.startsWith(`${name}=`))
  return m ? m.slice(name.length + 1) : null
}

const inDays = (d: number) => Date.now() + d * 86_400_000

beforeEach(() => {
  sessionStorage.clear()
  clearSession()
})

describe('sesión sin caja (web / sin identidad de dispositivo)', () => {
  it('JWT vigente: hay token y usuario', () => {
    setSession(jwt(600), user)
    expect(getAuthToken()).not.toBeNull()
    expect(getSessionUser()?.email).toBe('a@x.com')
    expect(deviceSessionUntil()).toBeNull()
  })

  it('JWT vencido cierra la sesión (comportamiento de siempre)', () => {
    sessionStorage.setItem('omero_auth_token', jwt(-60))
    sessionStorage.setItem('omero_auth_user', JSON.stringify(user))
    expect(getSessionUser()).toBeNull()
    expect(sessionStorage.getItem('omero_auth_token')).toBeNull()
  })
})

describe('sesión de caja con JWT vencido (sesión de 14 días vigente)', () => {
  it('setSession con fin de sesión escribe la cookie y alarga las de sesión', () => {
    setSession(jwt(600), user, undefined, inDays(14))
    expect(Number(cookie('omero_device_until'))).toBeGreaterThan(Date.now() + 13 * 86_400_000)
    expect(deviceSessionUntil()).not.toBeNull()
  })

  it('con el JWT vencido el usuario sigue en pantalla, pero NO se manda como credencial', () => {
    setSession(jwt(-120), user, undefined, inDays(14))
    expect(getSessionUser()?.email).toBe('a@x.com')
    expect(getAuthToken()).toBeNull() // la request sale sin token → 401 → renovación obligatoria
    expect(getSessionExpiry()).not.toBeNull() // useSessionRenewal puede detectar el vencimiento y renovar
    expect(sessionStorage.getItem('omero_auth_token')).not.toBeNull()
  })

  it('una pestaña nueva se rehidrata desde las cookies aunque el JWT esté vencido', () => {
    setSession(jwt(-120), user, undefined, inDays(14))
    sessionStorage.clear() // pestaña nueva: sin sessionStorage
    expect(getSessionUser()?.email).toBe('a@x.com')
  })

  it('al pasar la sesión de 14 días (cookie vencida) un JWT vencido vuelve a cerrar la sesión', () => {
    setSession(jwt(-120), user, undefined, inDays(14))
    document.cookie = 'omero_device_until=; Path=/; Max-Age=0'
    expect(getSessionUser()).toBeNull()
  })

  it('una renovación sin fin nuevo conserva el fin de sesión ya conocido', () => {
    setSession(jwt(600), user, undefined, inDays(14))
    const until = cookie('omero_device_until')
    setSession(jwt(3600), user)
    expect(cookie('omero_device_until')).toBe(until)
  })

  it('setDeviceSessionUntil ignora fines pasados y no hace nada sin sesión guardada', () => {
    setDeviceSessionUntil(inDays(14))
    expect(deviceSessionUntil()).toBeNull()
    setSession(jwt(600), user)
    setDeviceSessionUntil(Date.now() - 1000)
    expect(deviceSessionUntil()).toBeNull()
  })

  it('clearSession borra también la cookie de la caja', () => {
    setSession(jwt(-120), user, undefined, inDays(14))
    clearSession()
    expect(deviceSessionUntil()).toBeNull()
    expect(getSessionUser()).toBeNull()
  })
})
