// @vitest-environment node
/**
 * Integración del proxy contra un backend HTTP REAL (sin mockear fetch).
 *
 *   cliente (fetch) ──► servidor-adaptador ──► proxyToBackend ──► backend falso
 *
 * El servidor-adaptador hace lo mismo que Next: convierte la request de Node en un `Request` web
 * (con `signal` que se aborta si el cliente se desconecta) y escribe el `Response` con streaming.
 * Las señales de sincronización (promesas) reemplazan a los `sleep` para evitar flakiness.
 */
import { createHash } from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { Readable } from 'node:stream'
import { gzipSync } from 'node:zlib'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { proxyToBackend } from './backend-proxy'
import { GET as localHealth } from '../app/api/%5Flocal/health/route'

// ── helpers ──────────────────────────────────────────────────────────────────
function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

const within = <T,>(promise: Promise<T>, ms: number, label: string) =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timeout esperando: ${label}`)), ms)),
  ])

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)))
}

async function freeClosedPort(): Promise<number> {
  const s = http.createServer()
  const port = await listen(s)
  await new Promise((r) => s.close(r))
  return port
}

// ── backend falso ────────────────────────────────────────────────────────────
const sse = { releaseSecondEvent: deferred(), upstreamClosed: deferred(), finished: false }
const upload = { firstChunk: deferred(), bytes: 0, sha: '', contentType: '' }

const backend = http.createServer(async (req, res) => {
  const url = new URL(req.url!, 'http://backend')

  if (url.pathname === '/api/echo') {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Set-Cookie', ['a=1; Path=/', 'b=2; Path=/'])
    res.end(JSON.stringify({ method: req.method, path: url.pathname + url.search, headers: req.headers, body: Buffer.concat(chunks).toString() }))
  } else if (url.pathname.startsWith('/api/status/')) {
    res.writeHead(Number(url.pathname.split('/').pop()), { 'Content-Type': 'application/json' })
    res.end('{"success":false,"error":"boom"}')
  } else if (url.pathname === '/api/gzip') {
    const body = gzipSync(JSON.stringify({ hola: 'mundo', datos: 'x'.repeat(2000) }))
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'Content-Length': body.length })
    res.end(body)
  } else if (url.pathname === '/api/sse') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
    res.write('data: event-1\n\n')
    req.on('close', () => sse.upstreamClosed.resolve())
    await sse.releaseSecondEvent.promise
    if (!res.destroyed) {
      res.write('data: event-2\n\n')
      res.end()
      sse.finished = true
    }
  } else if (url.pathname === '/api/upload') {
    const hash = createHash('sha256')
    upload.contentType = String(req.headers['content-type'])
    for await (const chunk of req as AsyncIterable<Buffer>) {
      hash.update(chunk)
      upload.bytes += chunk.length
      upload.firstChunk.resolve() // el backend YA recibió algo, aunque el cliente no terminó de enviar
    }
    upload.sha = hash.digest('hex')
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ bytes: upload.bytes, sha: upload.sha }))
  } else if (url.pathname === '/api/hang') {
    // nunca responde
  } else {
    res.writeHead(404).end()
  }
})

// ── servidor adaptador (equivale a Next) ─────────────────────────────────────
const edge = http.createServer(async (req, res) => {
  const ac = new AbortController()
  res.on('close', () => {
    if (!res.writableFinished) ac.abort()
  })
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
  const request = new Request(`http://${req.headers.host}${req.url}`, {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined,
    duplex: 'half',
    signal: ac.signal,
  } as RequestInit)

  const response = await proxyToBackend(request)
  const headers: Record<string, string | string[]> = {}
  response.headers.forEach((value, key) => {
    if (key === 'set-cookie') return
    headers[key] = value
  })
  const cookies = response.headers.getSetCookie()
  if (cookies.length) headers['set-cookie'] = cookies
  res.writeHead(response.status, headers)
  if (response.body) {
    const stream = Readable.fromWeb(response.body as never)
    // Al cancelar el upstream (cliente desconectado) el stream falla con AbortError; Next lo absorbe.
    stream.on('error', () => res.destroy())
    stream.pipe(res)
  } else res.end()
})

let backendPort = 0
let edgeBase = ''

beforeAll(async () => {
  backendPort = await listen(backend)
  edgeBase = `http://127.0.0.1:${await listen(edge)}`
})

afterAll(async () => {
  backend.closeAllConnections()
  edge.closeAllConnections()
  await Promise.all([new Promise((r) => backend.close(r)), new Promise((r) => edge.close(r))])
})

beforeEach(() => {
  vi.stubEnv('OMERO_RUNTIME', 'web')
  vi.stubEnv('BACKEND_URL', `http://127.0.0.1:${backendPort}`)
  vi.stubEnv('PROXY_TIMEOUT_MS', '')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

// ── tests ────────────────────────────────────────────────────────────────────
describe('proxy → backend real', () => {
  it('GET/POST JSON: método, query, body y Authorization llegan íntegros; Origin/Referer no', async () => {
    const res = await fetch(`${edgeBase}/api/echo?x=1&y=a%20b`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer abc',
        Origin: 'http://127.0.0.1:3000',
        Referer: 'http://127.0.0.1:3000/pos',
      },
      body: JSON.stringify({ total: 1234.5 }),
    })
    expect(res.status).toBe(200)
    const echo = await res.json()
    expect(echo.method).toBe('POST')
    expect(echo.path).toBe('/api/echo?x=1&y=a%20b')
    expect(echo.body).toBe('{"total":1234.5}')
    expect(echo.headers.authorization).toBe('Bearer abc')
    expect(echo.headers.origin).toBeUndefined()
    expect(echo.headers.referer).toBeUndefined()
  })

  it('preserva set-cookie múltiples del backend', async () => {
    const res = await fetch(`${edgeBase}/api/echo`)
    expect(res.headers.getSetCookie()).toEqual(['a=1; Path=/', 'b=2; Path=/'])
  })

  it.each([401, 404, 500])('pasa el status %i del backend', async (status) => {
    const res = await fetch(`${edgeBase}/api/status/${status}`)
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual({ success: false, error: 'boom' })
  })

  it('backend con gzip: el cliente recibe el JSON correcto y sin content-encoding', async () => {
    const res = await fetch(`${edgeBase}/api/gzip`)
    expect(res.headers.has('content-encoding')).toBe(false)
    const data = await res.json()
    expect(data.hola).toBe('mundo')
    expect(data.datos).toHaveLength(2000)
  })

  it('subida multipart en streaming: el backend recibe datos ANTES de que el cliente termine y el contenido es íntegro', async () => {
    upload.firstChunk = deferred()
    upload.bytes = 0
    const chunkA = Buffer.alloc(1024 * 1024, 'a')
    const chunkB = Buffer.alloc(1024 * 1024, 'b')
    const boundary = '----omero-test-boundary'
    const expectedSha = createHash('sha256').update(chunkA).update(chunkB).digest('hex')

    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(chunkA)
        // Si el proxy bufferizara el request, el backend nunca vería chunkA hasta el final → deadlock.
        await within(upload.firstChunk.promise, 5000, 'primer chunk en el backend antes de terminar de enviar')
        controller.enqueue(chunkB)
        controller.close()
      },
    })

    const res = await fetch(`${edgeBase}/api/upload`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body,
      duplex: 'half',
    } as RequestInit)
    const result = await res.json()
    expect(result.bytes).toBe(2 * 1024 * 1024)
    expect(result.sha).toBe(expectedSha)
    expect(upload.contentType).toBe(`multipart/form-data; boundary=${boundary}`)
  })
})

describe('SSE', () => {
  it('los eventos llegan incrementalmente ANTES de que el upstream termine', async () => {
    sse.releaseSecondEvent = deferred()
    sse.upstreamClosed = deferred()
    sse.finished = false

    const res = await fetch(`${edgeBase}/api/sse`)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    expect(res.headers.get('cache-control')).toBe('no-cache, no-transform')
    expect(res.headers.get('x-accel-buffering')).toBe('no')

    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    const first = await within(reader.read(), 3000, 'primer evento SSE')
    expect(decoder.decode(first.value)).toContain('event-1')
    expect(sse.finished).toBe(false) // el upstream todavía no cerró: llegó en streaming

    sse.releaseSecondEvent.resolve()
    let rest = ''
    for (;;) {
      const { done, value } = await within(reader.read(), 3000, 'resto del stream')
      if (done) break
      rest += decoder.decode(value)
    }
    expect(rest).toContain('event-2')
  })

  it('si el cliente se desconecta, el upstream ve la conexión cerrada', async () => {
    sse.releaseSecondEvent = deferred()
    sse.upstreamClosed = deferred()
    sse.finished = false

    const client = new AbortController()
    const res = await fetch(`${edgeBase}/api/sse`, { signal: client.signal })
    const reader = res.body!.getReader()
    await within(reader.read(), 3000, 'primer evento SSE')

    client.abort() // EventSource.close() / cierre de pestaña
    await within(sse.upstreamClosed.promise, 3000, 'cierre de la conexión upstream')
    sse.releaseSecondEvent.resolve() // libera el handler del backend falso
  })
})

describe('errores', () => {
  it('backend caído → 502 con el contrato JSON del POS', async () => {
    vi.stubEnv('BACKEND_URL', `http://127.0.0.1:${await freeClosedPort()}`)
    const res = await fetch(`${edgeBase}/api/echo`)
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ success: false, error: 'No se pudo conectar con el servidor.' })
  })

  it('backend que no responde headers → 504 dentro del timeout configurado', async () => {
    vi.stubEnv('PROXY_TIMEOUT_MS', '200')
    const started = Date.now()
    const res = await fetch(`${edgeBase}/api/hang`)
    expect(res.status).toBe(504)
    expect(await res.json()).toEqual({ success: false, error: 'El servidor tardó demasiado en responder.' })
    expect(Date.now() - started).toBeLessThan(3000)
  })

  it('/api/_local/health responde local aunque el backend esté caído', async () => {
    vi.stubEnv('BACKEND_URL', `http://127.0.0.1:${await freeClosedPort()}`)
    vi.stubEnv('OMERO_RUNTIME', 'desktop')
    const res = await localHealth()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, runtime: 'desktop', backendConfigured: true })
  })
})
