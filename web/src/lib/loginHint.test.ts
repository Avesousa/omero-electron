import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { classifyIdentifier, fetchLoginOptions, loadLoginHint, saveLoginHint } from './loginHint'

const T = '724c4579-ea83-4cef-9f37-bcfbfcc12268'
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('classifyIdentifier (clave vs email)', () => {
  it.each([
    ['12345678', 'key'], ['123456', 'key'], ['0123456789', 'key'], ['  123456  ', 'key'],
    ['12345', 'email'], ['12345678901', 'email'], ['12a45678', 'email'], ['a@b.com', 'email'], ['1234@5678', 'email'],
    ['', 'email'], ['١٢٣٤٥٦٧٨', 'email'],
  ] as const)('%j → %s', (input, kind) => expect(classifyIdentifier(input)).toBe(kind))

  it('respeta los largos que informa el backend', () => {
    expect(classifyIdentifier('1234', 4, 4)).toBe('key')
    expect(classifyIdentifier('12345', 4, 4)).toBe('email')
  })
})

describe('persistencia de la pista', () => {
  it('desktop: usa el Next local y no toca el localStorage', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ success: true, data: { available: true, saved: true } }))
    await saveLoginHint({ tenantId: T, quickKeyLoginEnabled: true })
    expect(fetchSpy).toHaveBeenCalledWith('/api/_local/login-hint', expect.objectContaining({ method: 'PUT' }))
    expect(localStorage.getItem('omero_login_hint')).toBeNull()

    fetchSpy.mockResolvedValue(json({ success: true, data: { available: true, hint: { tenantId: T, quickKeyLoginEnabled: true } } }))
    expect(await loadLoginHint()).toEqual({ tenantId: T, quickKeyLoginEnabled: true })
  })

  it('web (available:false): cae al localStorage', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ success: true, data: { available: false } }))
    expect(await loadLoginHint()).toBeNull() // primera vez
    await saveLoginHint({ tenantId: T, quickKeyLoginEnabled: false })
    expect(JSON.parse(localStorage.getItem('omero_login_hint')!)).toEqual({ tenantId: T, quickKeyLoginEnabled: false })
    expect(await loadLoginHint()).toEqual({ tenantId: T, quickKeyLoginEnabled: false })
  })

  it('servidor local caído: localStorage y nunca lanza', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('down'))
    await saveLoginHint({ tenantId: T, quickKeyLoginEnabled: true })
    expect(await loadLoginHint()).toEqual({ tenantId: T, quickKeyLoginEnabled: true })
  })

  it('no guarda un tenantId inválido', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await saveLoginHint({ tenantId: 'no-es-uuid', quickKeyLoginEnabled: true })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('fetchLoginOptions', () => {
  it('devuelve las opciones públicas del negocio', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json({ success: true, data: { quickKeyLoginEnabled: true, quickKeyMinLength: 6, quickKeyMaxLength: 10 } }),
    )
    expect(await fetchLoginOptions(T)).toEqual({ quickKeyLoginEnabled: true, quickKeyMinLength: 6, quickKeyMaxLength: 10 })
    expect(String(spy.mock.calls[0][0])).toBe(`/api/auth/login-options/${T}`)
  })

  it.each([
    ['sin conexión', () => Promise.reject(new Error('net'))],
    ['backend viejo (404)', () => Promise.resolve(json({ success: false }, 404))],
    ['respuesta sin el flag', () => Promise.resolve(json({ success: true, data: {} }))],
  ])('%s → null (se queda con el último valor conocido)', async (_n, impl) => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(impl as never)
    expect(await fetchLoginOptions(T)).toBeNull()
  })

  it('un tenantId inválido ni consulta', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
    expect(await fetchLoginOptions('../x')).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('regresión: la pista de login nunca puede bloquear la pantalla (relanzamiento en blanco)', () => {
  it('loadLoginHint con el servidor local colgado se aborta por timeout y cae al localStorage', async () => {
    vi.useFakeTimers()
    localStorage.setItem('omero_login_hint', JSON.stringify({ tenantId: T, quickKeyLoginEnabled: true }))
    vi.spyOn(globalThis, 'fetch').mockImplementation((_u, init) => new Promise((_res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(new Error('aborted')))
    }))
    const p = loadLoginHint()
    await vi.advanceTimersByTimeAsync(3_100)
    expect(await p).toEqual({ tenantId: T, quickKeyLoginEnabled: true })
    vi.useRealTimers()
  })

  it('saveLoginHint con el servidor local colgado termina (timeout) y guarda en localStorage', async () => {
    vi.useFakeTimers()
    vi.spyOn(globalThis, 'fetch').mockImplementation((_u, init) => new Promise((_res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(new Error('aborted')))
    }))
    const p = saveLoginHint({ tenantId: T, quickKeyLoginEnabled: true })
    await vi.advanceTimersByTimeAsync(3_100)
    await p
    expect(localStorage.getItem('omero_login_hint')).not.toBeNull()
    vi.useRealTimers()
  })
})
