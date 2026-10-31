import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const authHeaders = vi.fn()
vi.mock('@/lib/sessionManager', () => ({ authHeaders: () => authHeaders() }))

import { logoutWarning, pendingOutboxCount, wipeLocalCatalogCache } from './localCache'

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  authHeaders.mockReset()
})

describe('wipeLocalCatalogCache', () => {
  it('envía DELETE /api/_local/cache con el Authorization de la sesión y keepalive', () => {
    authHeaders.mockReturnValue({ Authorization: 'Bearer abc.def.ghi' })
    wipeLocalCatalogCache()
    expect(fetchMock).toHaveBeenCalledWith('/api/_local/cache', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer abc.def.ghi' },
      keepalive: true,
    })
  })

  it('sin sesión no hace ninguna request', () => {
    authHeaders.mockReturnValue({})
    wipeLocalCatalogCache()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('un fallo de red no lanza ni queda como promesa rechazada', async () => {
    authHeaders.mockReturnValue({ Authorization: 'Bearer x' })
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    expect(() => wipeLocalCatalogCache()).not.toThrow()
    await Promise.resolve() // deja correr el .catch interno: si quedara sin manejar, vitest lo reportaría
  })

  it('si authHeaders lanza, el logout no se rompe', () => {
    authHeaders.mockImplementation(() => {
      throw new Error('sessionStorage bloqueado')
    })
    expect(() => wipeLocalCatalogCache()).not.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('pendingOutboxCount / logoutWarning', () => {
  it('cuenta los pendientes del outbox local', async () => {
    authHeaders.mockReturnValue({ Authorization: 'Bearer t' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true, data: { available: true, counts: { pending: 4 } } }))))
    expect(await pendingOutboxCount()).toBe(4)
  })

  it.each([
    ['sin sesión', {}, undefined],
    ['web / outbox no disponible', { Authorization: 'Bearer t' }, { success: true, data: { available: false, counts: { pending: 9 } } }],
    ['respuesta inesperada', { Authorization: 'Bearer t' }, { success: false }],
  ])('%s → 0', async (_n, headers, body) => {
    authHeaders.mockReturnValue(headers)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body ?? {}))))
    expect(await pendingOutboxCount()).toBe(0)
  })

  it('si el servidor local no responde → 0 (jamás impide cerrar sesión)', async () => {
    authHeaders.mockReturnValue({ Authorization: 'Bearer t' })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('x') }))
    expect(await pendingOutboxCount()).toBe(0)
  })

  it('el aviso concuerda en singular y plural y aclara que NO se borra', () => {
    expect(logoutWarning(1)).toContain('1 venta/gasto sin subir')
    expect(logoutWarning(3)).toContain('3 ventas/gastos sin subir')
    expect(logoutWarning(2)).toContain('NO las borra')
  })
})
