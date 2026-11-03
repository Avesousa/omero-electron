import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  REFRESH_RETRY_DELAYS_MS,
  clearSession,
  deviceSessionUntil,
  setDeviceSessionUntil,
  getAuthToken,
  getFreshAuthHeaders,
  getSessionUser,
  refreshSession,
  setSession,
  startSessionRenewal,
  stopSessionRenewal,
} from './sessionManager'

const user = { id: '1', name: 'Ana', email: 'ana@x.com', role: 'omero-admin', tenantId: 't1', permissions: ['PRODUCTOS_VER'] }

function makeJwt(expOffsetSeconds: number): string {
  const payload = btoa(JSON.stringify({ sub: '1', exp: Math.floor(Date.now() / 1000) + expOffsetSeconds }))
  return `h.${payload}.s`
}

function wipeCookies() {
  document.cookie.split('; ').forEach(c => {
    const name = c.split('=')[0]
    if (name) document.cookie = `${name}=; Path=/; Max-Age=0`
  })
}

describe('sessionManager (modo web)', () => {
  beforeEach(() => {
    sessionStorage.clear()
    wipeCookies()
  })

  it('guarda y recupera la sesión', () => {
    const jwt = makeJwt(3600)
    setSession(jwt, user)
    expect(getAuthToken()).toBe(jwt)
    expect(getSessionUser()).toEqual(user)
  })

  it('rehidrata la sesión en una pestaña nueva (sessionStorage vacío) desde las cookies', () => {
    const jwt = makeJwt(3600)
    setSession(jwt, user)
    sessionStorage.clear() // simula pestaña nueva: cookies compartidas, sessionStorage no

    expect(getSessionUser()).toEqual(user)
    expect(getAuthToken()).toBe(jwt)
  })

  it('no rehidrata con un token vencido', () => {
    const jwt = makeJwt(-10)
    document.cookie = `omero_session=${jwt}; Path=/`
    document.cookie = `omero_user=${encodeURIComponent(JSON.stringify(user))}; Path=/`
    expect(getAuthToken()).toBeNull()
    expect(getSessionUser()).toBeNull()
  })

  it('clearSession borra también las cookies', () => {
    setSession(makeJwt(3600), user)
    clearSession()
    expect(getAuthToken()).toBeNull()
    expect(document.cookie).not.toContain('omero_')
  })
})

describe('renovación de sesión', () => {
  const fetchMock = vi.fn()

  function refreshResponse(body: unknown, status = 200) {
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) }
  }

  beforeEach(() => {
    sessionStorage.clear()
    clearSession() // también vacía el respaldo en memoria del refresh token
    localStorage.clear()
    wipeCookies()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('setSession guarda el refresh token y la cookie-señal', () => {
    setSession(makeJwt(3600), user, 'rt-1')
    expect(localStorage.getItem('omero_refresh_token')).toBe('rt-1')
    expect(document.cookie).toContain('omero_has_refresh=1')
  })

  it('con refresh token una sesión con JWT vencido sigue siendo recuperable', () => {
    setSession(makeJwt(-10), user, 'rt-1')
    expect(getAuthToken()).toBeNull()
    expect(getSessionUser()).toEqual(user)
  })

  it('renueva, ROTA el refresh token y reescribe la cookie', async () => {
    setSession(makeJwt(10), user, 'rt-1')
    const nuevo = makeJwt(3600)
    fetchMock.mockResolvedValue(refreshResponse({ success: true, data: { accessToken: nuevo, refreshToken: 'rt-2', expiresIn: 3600 } }))

    const r = await refreshSession()

    expect(r).toEqual({ ok: true })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ refreshToken: 'rt-1' })
    expect(localStorage.getItem('omero_refresh_token')).toBe('rt-2')
    expect(getAuthToken()).toBe(nuevo)
    expect(document.cookie).toContain(`omero_session=${nuevo}`)
  })

  it('single-flight: llamadas simultáneas hacen un solo request', async () => {
    setSession(makeJwt(10), user, 'rt-1')
    fetchMock.mockResolvedValue(refreshResponse({ accessToken: makeJwt(3600), refreshToken: 'rt-2' }))

    const [a, b, c] = await Promise.all([refreshSession(), refreshSession(), refreshSession()])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect([a, b, c]).toEqual([{ ok: true }, { ok: true }, { ok: true }])
  })

  it('no llama al backend si otra pestaña ya renovó (cookie con JWT vigente >5 min)', async () => {
    setSession(makeJwt(10), user, 'rt-1')
    // otra pestaña dejó un JWT nuevo en la cookie; este sessionStorage sigue con el viejo
    document.cookie = `omero_session=${makeJwt(3600)}; Path=/`

    const r = await refreshSession()

    expect(r).toEqual({ ok: true })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('SESSION_REPLACED es un fallo definitivo con motivo replaced', async () => {
    setSession(makeJwt(10), user, 'rt-1')
    fetchMock.mockResolvedValue(refreshResponse({ success: false, code: 'SESSION_REPLACED' }, 401))
    expect(await refreshSession()).toEqual({ ok: false, reason: 'replaced' })
  })

  it('TOKEN_INVALID es un fallo definitivo', async () => {
    setSession(makeJwt(10), user, 'rt-1')
    fetchMock.mockResolvedValue(refreshResponse({ success: false, code: 'TOKEN_INVALID' }, 401))
    expect(await refreshSession()).toEqual({ ok: false, reason: 'invalid' })
  })

  it('sin refresh token devuelve none', async () => {
    setSession(makeJwt(10), user)
    expect(await refreshSession()).toEqual({ ok: false, reason: 'none' })
  })

  it('un fallo de red reintenta con backoff y NO borra la sesión', async () => {
    setSession(makeJwt(10), user, 'rt-1')
    fetchMock.mockRejectedValue(new TypeError('network'))

    const p = refreshSession()
    await vi.advanceTimersByTimeAsync(10_000)
    const r = await p

    expect(r).toEqual({ ok: false, reason: 'network' })
    expect(fetchMock).toHaveBeenCalledTimes(1 + REFRESH_RETRY_DELAYS_MS.length)
    expect(localStorage.getItem('omero_refresh_token')).toBe('rt-1')
    expect(getSessionUser()).toEqual(user)
  })

  it('un fallo de red que se recupera en el reintento renueva', async () => {
    setSession(makeJwt(10), user, 'rt-1')
    fetchMock
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce(refreshResponse({ accessToken: makeJwt(3600), refreshToken: 'rt-2' }))

    const p = refreshSession()
    await vi.advanceTimersByTimeAsync(5_000)

    expect(await p).toEqual({ ok: true })
  })

  it('un 503 del backend se trata como transitorio, no como sesión perdida', async () => {
    setSession(makeJwt(10), user, 'rt-1')
    fetchMock.mockResolvedValue(refreshResponse({}, 503))
    const p = refreshSession()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await p).toEqual({ ok: false, reason: 'network' })
  })

  it('getFreshAuthHeaders espera el refresh cuando el JWT venció y usa el token nuevo', async () => {
    setSession(makeJwt(-10), user, 'rt-1')
    const nuevo = makeJwt(3600)
    fetchMock.mockResolvedValue(refreshResponse({ accessToken: nuevo, refreshToken: 'rt-2' }))

    expect(await getFreshAuthHeaders()).toEqual({ Authorization: `Bearer ${nuevo}` })
  })

  it('getFreshAuthHeaders con fallo definitivo cierra la sesión y devuelve null', async () => {
    setSession(makeJwt(-10), user, 'rt-1')
    fetchMock.mockResolvedValue(refreshResponse({ code: 'TOKEN_INVALID' }, 401))

    expect(await getFreshAuthHeaders()).toBeNull()
    expect(localStorage.getItem('omero_refresh_token')).toBeNull()
    expect(document.cookie).not.toContain('omero_has_refresh')
  })

  it('clearSession borra el refresh token pero no los borradores', () => {
    localStorage.setItem('omero_draft:producto', '{"a":1}')
    setSession(makeJwt(3600), user, 'rt-1')
    clearSession()
    expect(localStorage.getItem('omero_refresh_token')).toBeNull()
    expect(localStorage.getItem('omero_draft:producto')).toBe('{"a":1}')
  })

  describe('renovación proactiva', () => {
    afterEach(() => stopSessionRenewal())

    it('renueva ~1 min antes del vencimiento si hubo actividad reciente', async () => {
      setSession(makeJwt(50), user, 'rt-1')
      fetchMock.mockResolvedValue(refreshResponse({ accessToken: makeJwt(3600), refreshToken: 'rt-2' }))
      startSessionRenewal()

      await vi.advanceTimersByTimeAsync(16_000)

      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('NO renueva si no hubo actividad en los últimos 10 min', async () => {
      setSession(makeJwt(15 * 60), user, 'rt-1')
      startSessionRenewal()

      // 14,5 min sin eventos de usuario: faltan 30 s para el vencimiento pero la actividad es vieja
      await vi.advanceTimersByTimeAsync(14.5 * 60_000)

      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('con actividad reciente (evento de usuario) sí renueva en esa misma ventana', async () => {
      setSession(makeJwt(15 * 60), user, 'rt-1')
      fetchMock.mockResolvedValue(refreshResponse({ accessToken: makeJwt(3600), refreshToken: 'rt-2' }))
      startSessionRenewal()

      await vi.advanceTimersByTimeAsync(14 * 60_000)
      window.dispatchEvent(new Event('pointerdown'))
      await vi.advanceTimersByTimeAsync(30_000)

      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('al volver a la pestaña renueva si vence en menos de 5 min', async () => {
      setSession(makeJwt(120), user, 'rt-1')
      fetchMock.mockResolvedValue(refreshResponse({ accessToken: makeJwt(3600), refreshToken: 'rt-2' }))
      startSessionRenewal()

      window.dispatchEvent(new Event('focus'))
      await vi.advanceTimersByTimeAsync(0)

      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('al volver a la pestaña NO renueva si queda más de 5 min', async () => {
      setSession(makeJwt(1800), user, 'rt-1')
      startSessionRenewal()
      window.dispatchEvent(new Event('focus'))
      await vi.advanceTimersByTimeAsync(0)
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })
})


describe('coexistencia con la sesión de la caja (omero_device_until vs omero_has_refresh)', () => {
  const cookie = (name: string) => document.cookie.split('; ').find(c => c.startsWith(`${name}=`))?.slice(name.length + 1) ?? null
  const inDays = (d: number) => Date.now() + d * 86_400_000

  beforeEach(() => {
    sessionStorage.clear()
    clearSession()
    localStorage.clear()
    wipeCookies()
  })

  it('login de caja (refreshToken null): NO guarda refresh token ni cookie omero_has_refresh', () => {
    localStorage.setItem('omero_refresh_token', 'viejo-de-una-sesion-web')
    setSession(makeJwt(3600), user, null)
    expect(localStorage.getItem('omero_refresh_token')).toBeNull() // se descarta cualquier refresh previo
    expect(cookie('omero_has_refresh')).toBeNull()
    expect(getSessionUser()).toEqual(user)
  })

  it('modo web: no escribe omero_device_until; una caja no escribe omero_has_refresh', () => {
    setSession(makeJwt(3600), user, 'rt-1')
    expect(cookie('omero_has_refresh')).toBe('1')
    expect(cookie('omero_device_until')).toBeNull()
    clearSession()
    setSession(makeJwt(3600), user, null, inDays(14))
    expect(cookie('omero_device_until')).not.toBeNull()
    expect(cookie('omero_has_refresh')).toBeNull()
  })

  it('clearSession limpia TODO: refresh token, cookie de refresh y cookie de la caja', () => {
    setSession(makeJwt(3600), user, 'rt-1', inDays(14))
    expect(cookie('omero_has_refresh')).toBe('1')
    expect(cookie('omero_device_until')).not.toBeNull()
    clearSession()
    expect(localStorage.getItem('omero_refresh_token')).toBeNull()
    expect(cookie('omero_has_refresh')).toBeNull()
    expect(cookie('omero_device_until')).toBeNull()
    expect(deviceSessionUntil()).toBeNull()
  })

  it('una caja con JWT vencido y sesión de 14 días vigente sigue en pantalla SIN refresh token', () => {
    setSession(makeJwt(-120), user, null, inDays(14))
    expect(getSessionUser()).toEqual(user)
    expect(getAuthToken()).toBeNull()
  })

  it('una renovación de la caja (refreshToken undefined) no inventa un refresh token', () => {
    setSession(makeJwt(3600), user, null, inDays(14))
    setSession(makeJwt(7200), user)
    expect(localStorage.getItem('omero_refresh_token')).toBeNull()
    expect(cookie('omero_has_refresh')).toBeNull()
    expect(deviceSessionUntil()).not.toBeNull()
  })

  it('web con JWT vencido y SIN refresh token ni caja: sesión cerrada (como siempre)', () => {
    sessionStorage.setItem('omero_auth_token', makeJwt(-60))
    sessionStorage.setItem('omero_auth_user', JSON.stringify(user))
    expect(getSessionUser()).toBeNull()
  })

  it('getFreshAuthHeaders en una caja (sin refresh token) NO llama al refresh web', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    setSession(makeJwt(-10), user, null, inDays(14))
    expect(await getFreshAuthHeaders()).toEqual({})
    expect(f).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('setDeviceSessionUntil no crea refresh token', () => {
    setSession(makeJwt(3600), user)
    setDeviceSessionUntil(inDays(5))
    expect(localStorage.getItem('omero_refresh_token')).toBeNull()
  })
})
