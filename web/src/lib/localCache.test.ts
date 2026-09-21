import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const authHeaders = vi.fn()
vi.mock('@/lib/sessionManager', () => ({ authHeaders: () => authHeaders() }))

import { wipeLocalCatalogCache } from './localCache'

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
