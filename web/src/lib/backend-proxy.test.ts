// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { proxyToBackend } from './backend-proxy'

const BACKEND = 'https://backend.example.com'

type FetchMock = ReturnType<typeof vi.fn>
let fetchMock: FetchMock

function lastCall() {
  const [url, init] = fetchMock.mock.calls.at(-1)! as [URL, RequestInit & { duplex?: string }]
  return { url, init, headers: init.headers as Headers }
}

beforeEach(() => {
  vi.stubEnv('OMERO_RUNTIME', 'web')
  vi.stubEnv('BACKEND_URL', BACKEND)
  vi.stubEnv('PROXY_TIMEOUT_MS', '')
  fetchMock = vi.fn(async () => new Response('{"success":true}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('destino', () => {
  it('reenvía método, path anidado y query al backend configurado', async () => {
    const res = await proxyToBackend(new Request('http://localhost:3000/api/products/12/stock?from=a&to=b', { method: 'PUT', body: '{}' }))
    expect(res.status).toBe(200)
    const { url, init } = lastCall()
    expect(url.toString()).toBe(`${BACKEND}/api/products/12/stock?from=a&to=b`)
    expect(init.method).toBe('PUT')
  })

  it.each([
    'http://localhost:3000//evil.com/api/x',
    'http://localhost:3000/admin',
    'http://localhost:3000/apix/y',
    'http://localhost:3000/api',
    'http://localhost:3000/api/../admin',
    'http://localhost:3000/api/%2e%2e/admin',
    'http://localhost:3000/api/..%2f..%2fadmin/../../x',
  ])('rechaza paths que no son /api/* válidos: %s', async (url) => {
    const res = await proxyToBackend(new Request(url))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ success: false, error: 'Ruta inválida.' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('un path con "//" dentro de /api/ no cambia el origen destino', async () => {
    await proxyToBackend(new Request('http://localhost:3000/api//evil.com/x'))
    expect(lastCall().url.origin).toBe(BACKEND)
  })

  it('rechaza una request con URL inválida', async () => {
    const broken = { url: 'no-es-url', method: 'GET', headers: new Headers(), body: null, signal: new AbortController().signal }
    const res = await proxyToBackend(broken as unknown as Request)
    expect(res.status).toBe(400)
  })

  it('responde 500 genérico (sin detalles) si BACKEND_URL es inválida', async () => {
    vi.stubEnv('BACKEND_URL', '')
    const res = await proxyToBackend(new Request('http://localhost:3000/api/x'))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ success: false, error: 'Configuración del servidor inválida.' })
  })
})

describe('headers de request', () => {
  it('no reenvía hop-by-hop, host, content-length, origin ni referer; sí Authorization y custom', async () => {
    await proxyToBackend(
      new Request('http://localhost:3000/api/x', {
        method: 'POST',
        body: 'abc',
        headers: {
          Authorization: 'Bearer token',
          'X-Custom': '1',
          Connection: 'keep-alive',
          'Keep-Alive': 'timeout=5',
          Upgrade: 'websocket',
          Origin: 'http://127.0.0.1:3000',
          Referer: 'http://127.0.0.1:3000/pos',
          Host: 'localhost:3000',
          'Content-Type': 'application/json',
        },
      }),
    )
    const { headers } = lastCall()
    expect(headers.get('authorization')).toBe('Bearer token')
    expect(headers.get('x-custom')).toBe('1')
    expect(headers.get('content-type')).toBe('application/json')
    for (const name of ['connection', 'keep-alive', 'upgrade', 'origin', 'referer', 'host', 'content-length']) {
      expect(headers.has(name), name).toBe(false)
    }
  })
})

describe('body y redirects', () => {
  it('POST envía el body en streaming (duplex half)', async () => {
    await proxyToBackend(new Request('http://localhost:3000/api/sales', { method: 'POST', body: '{"total":10}' }))
    const { init } = lastCall()
    expect(init.body).toBeInstanceOf(ReadableStream)
    expect(init.duplex).toBe('half')
  })

  it.each(['GET', 'HEAD'])('%s no envía body', async (method) => {
    await proxyToBackend(new Request('http://localhost:3000/api/x', { method }))
    const { init } = lastCall()
    expect(init.body).toBeUndefined()
    expect(init.duplex).toBeUndefined()
  })

  it('no sigue redirects: los devuelve al cliente', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: '/otro' } }))
    const res = await proxyToBackend(new Request('http://localhost:3000/api/x'))
    expect(lastCall().init.redirect).toBe('manual')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/otro')
  })
})

describe('response', () => {
  it.each([401, 403, 404, 500])('pasa el status %i y el body sin modificar', async (status) => {
    fetchMock.mockResolvedValueOnce(new Response(`{"success":false,"error":"e${status}"}`, { status, headers: { 'Content-Type': 'application/json' } }))
    const res = await proxyToBackend(new Request('http://localhost:3000/api/x'))
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual({ success: false, error: `e${status}` })
    expect(res.headers.get('content-type')).toBe('application/json')
  })

  it('quita content-encoding y content-length (fetch ya descomprimió) y hop-by-hop', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('plano', { headers: { 'Content-Encoding': 'gzip', 'Content-Length': '999', Connection: 'keep-alive', 'Keep-Alive': 'timeout=5', 'X-Keep': 'ok' } }),
    )
    const res = await proxyToBackend(new Request('http://localhost:3000/api/x'))
    expect(res.headers.has('content-encoding')).toBe(false)
    expect(res.headers.has('content-length')).toBe(false)
    expect(res.headers.has('connection')).toBe(false)
    expect(res.headers.has('keep-alive')).toBe(false)
    expect(res.headers.get('x-keep')).toBe('ok')
    expect(await res.text()).toBe('plano')
  })

  it('conserva content-length cuando no hay content-encoding', async () => {
    fetchMock.mockResolvedValueOnce(new Response('12345', { headers: { 'Content-Length': '5' } }))
    const res = await proxyToBackend(new Request('http://localhost:3000/api/x'))
    expect(res.headers.get('content-length')).toBe('5')
  })

  it('preserva múltiples set-cookie', async () => {
    const upstream = new Headers()
    upstream.append('Set-Cookie', 'a=1; Path=/')
    upstream.append('Set-Cookie', 'b=2; Path=/')
    fetchMock.mockResolvedValueOnce(new Response('ok', { headers: upstream }))
    const res = await proxyToBackend(new Request('http://localhost:3000/api/x'))
    expect(res.headers.getSetCookie()).toEqual(['a=1; Path=/', 'b=2; Path=/'])
  })

  it('SSE: fuerza no-cache/no-transform y desactiva el buffering', async () => {
    fetchMock.mockResolvedValueOnce(new Response('data: hola\n\n', { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } }))
    const res = await proxyToBackend(new Request('http://localhost:3000/api/mercadopago/events'))
    expect(res.headers.get('cache-control')).toBe('no-cache, no-transform')
    expect(res.headers.get('x-accel-buffering')).toBe('no')
  })

  it('no toca cache-control en respuestas normales', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { headers: { 'Cache-Control': 'max-age=60' } }))
    const res = await proxyToBackend(new Request('http://localhost:3000/api/x'))
    expect(res.headers.get('cache-control')).toBe('max-age=60')
    expect(res.headers.has('x-accel-buffering')).toBe(false)
  })

  it('respuesta sin body (204) pasa sin body', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    const res = await proxyToBackend(new Request('http://localhost:3000/api/x', { method: 'DELETE' }))
    expect(res.status).toBe(204)
    expect(res.body).toBeNull()
  })
})

describe('errores del proxy', () => {
  it('502 si el backend es inalcanzable, sin filtrar detalles internos', async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }))
    const res = await proxyToBackend(new Request('http://localhost:3000/api/x'))
    expect(res.status).toBe(502)
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({ success: false, error: 'No se pudo conectar con el servidor.' })
    expect(text).not.toContain('backend.example.com')
    expect(text).not.toContain('ECONNREFUSED')
    expect(console.error).toHaveBeenCalled()
  })

  it('502 aunque el error no traiga cause ni name útil', async () => {
    fetchMock.mockRejectedValueOnce(undefined)
    const res = await proxyToBackend(new Request('http://localhost:3000/api/x'))
    expect(res.status).toBe(502)
  })

  it('504 si el backend no responde los headers a tiempo (PROXY_TIMEOUT_MS)', async () => {
    vi.stubEnv('PROXY_TIMEOUT_MS', '30')
    fetchMock.mockImplementationOnce(
      (_url: URL, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    )
    const res = await proxyToBackend(new Request('http://localhost:3000/api/x'))
    expect(res.status).toBe(504)
    expect(await res.json()).toEqual({ success: false, error: 'El servidor tardó demasiado en responder.' })
  })

  it('499 si el cliente ya se había ido', async () => {
    const client = new AbortController()
    client.abort()
    fetchMock.mockImplementationOnce(
      (_url: URL, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          if (init.signal!.aborted) reject(new DOMException('aborted', 'AbortError'))
        }),
    )
    const res = await proxyToBackend(new Request('http://localhost:3000/api/x', { signal: client.signal }))
    expect(res.status).toBe(499)
  })

  it('el timeout se limpia al recibir headers (no aborta un stream largo)', async () => {
    vi.stubEnv('PROXY_TIMEOUT_MS', '30')
    const res = await proxyToBackend(new Request('http://localhost:3000/api/x'))
    await new Promise((r) => setTimeout(r, 80))
    expect(lastCall().init.signal!.aborted).toBe(false)
    expect(res.status).toBe(200)
  })
})

describe('cancelación (SSE)', () => {
  it('si el cliente se desconecta DESPUÉS de recibir la respuesta, se aborta el upstream', async () => {
    const client = new AbortController()
    fetchMock.mockResolvedValueOnce(new Response('data: 1\n\n', { headers: { 'Content-Type': 'text/event-stream' } }))
    const res = await proxyToBackend(new Request('http://localhost:3000/api/mercadopago/events', { signal: client.signal }))
    const upstreamSignal = lastCall().init.signal!
    expect(res.status).toBe(200)
    expect(upstreamSignal.aborted).toBe(false)

    client.abort() // el navegador cierra la pestaña / EventSource.close()
    expect(upstreamSignal.aborted).toBe(true)
  })
})
