// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkBackend } from './connectivity'

afterEach(() => {
  vi.unstubAllEnvs()
})

const opts = (fetchFn: typeof fetch, extra = {}) => ({ fetchFn, backendUrl: 'https://backend.test', ...extra })

describe('checkBackend', () => {
  it('online cuando /api/health responde 2xx (con latencia)', async () => {
    const fetchFn = vi.fn(async () => new Response('{"status":"UP"}', { status: 200 }))
    const status = await checkBackend(opts(fetchFn as unknown as typeof fetch))
    expect(status.online).toBe(true)
    expect(status.latencyMs).toBeGreaterThanOrEqual(0)
    expect(Date.parse(status.checkedAt)).not.toBeNaN()
    expect(fetchFn).toHaveBeenCalledWith('https://backend.test/api/health', expect.objectContaining({ method: 'GET' }))
  })

  it.each([500, 502, 503, 504])('un %i del backend/gateway cuenta como offline', async (code) => {
    const status = await checkBackend(opts((async () => new Response('x', { status: code })) as unknown as typeof fetch))
    expect(status).toMatchObject({ online: false, latencyMs: null })
  })

  it('un error de red (ECONNREFUSED) es offline', async () => {
    const status = await checkBackend(opts((async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch))
    expect(status).toMatchObject({ online: false, latencyMs: null })
  })

  it('un backend que no responde dentro del timeout es offline', async () => {
    const hang = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => reject(new DOMException('timeout', 'TimeoutError')))
      })) as unknown as typeof fetch
    const started = Date.now()
    const status = await checkBackend(opts(hang, { timeoutMs: 40 }))
    expect(status.online).toBe(false)
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('sin BACKEND_URL válida es offline (no lanza)', async () => {
    vi.stubEnv('BACKEND_URL', '')
    const status = await checkBackend({ fetchFn: vi.fn() as unknown as typeof fetch })
    expect(status.online).toBe(false)
  })

  it('usa BACKEND_URL del entorno por defecto', async () => {
    vi.stubEnv('BACKEND_URL', 'https://desde-env.test')
    const fetchFn = vi.fn(async () => new Response('ok'))
    await checkBackend({ fetchFn: fetchFn as unknown as typeof fetch })
    expect(fetchFn).toHaveBeenCalledWith('https://desde-env.test/api/health', expect.anything())
  })
})
