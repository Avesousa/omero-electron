import { getBackendUrl, getProxyTimeoutMs } from './runtime'

/**
 * Proxy `/api/*` → omero-backend, en runtime.
 *
 * Reglas (ver AiBuild/feature/pos-standalone-next-web-mode/WIP/technical-spec.md):
 * - Destino: siempre el origen configurado en BACKEND_URL + el path `/api/...` de la request.
 * - Streaming en ambos sentidos (sin bufferizar): SSE de MercadoPago y cargas multipart.
 * - Errores propios del proxy usan el contrato JSON del POS: `{ success: false, error }`.
 */

/** Headers hop-by-hop (RFC 9110 §7.6.1): nunca se reenvían. */
const HOP_BY_HOP = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]

/**
 * Headers de request que no se reenvían:
 * - `host` y `content-length`: los recalcula fetch.
 * - `origin` y `referer`: es una llamada servidor-a-servidor. Si se reenviara el Origin del navegador
 *   (localhost:3000, 127.0.0.1:3000, dominio del POS en Railway) el backend aplicaría CORS y respondería
 *   403 para cualquier origen que no esté en CORS_ALLOWED_ORIGINS.
 */
const STRIP_FROM_REQUEST = new Set([...HOP_BY_HOP, 'host', 'content-length', 'origin', 'referer'])

const STRIP_FROM_RESPONSE = new Set(HOP_BY_HOP)

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ success: false, error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function forwardRequestHeaders(source: Headers): Headers {
  const headers = new Headers()
  source.forEach((value, key) => {
    if (!STRIP_FROM_REQUEST.has(key.toLowerCase())) headers.append(key, value)
  })
  return headers
}

function forwardResponseHeaders(source: Headers): Headers {
  const headers = new Headers()
  source.forEach((value, key) => {
    if (!STRIP_FROM_RESPONSE.has(key.toLowerCase())) headers.append(key, value)
  })
  // `fetch` (undici) descomprime el cuerpo: si se dejara el encoding/length original el cliente
  // recibiría un payload plano marcado como gzip (o con longitud incorrecta).
  if (headers.has('content-encoding')) {
    headers.delete('content-encoding')
    headers.delete('content-length')
  }
  // Los set-cookie múltiples se preservan porque se copian con `append` desde `forEach`.
  return headers
}

/**
 * Resuelve la URL destino o `null` si la request no es un `/api/*` válido.
 * `new URL()` ya normaliza `..`, `%2e%2e` y `\`, así que se valida el pathname normalizado.
 */
function resolveTarget(requestUrl: string, backendOrigin: string): URL | null {
  let source: URL
  try {
    source = new URL(requestUrl)
  } catch {
    return null
  }
  if (!source.pathname.startsWith('/api/')) return null

  const target = new URL(source.pathname + source.search, backendOrigin)
  return target.origin === backendOrigin ? target : null
}

export async function proxyToBackend(request: Request): Promise<Response> {
  let backendOrigin: string
  try {
    backendOrigin = getBackendUrl()
  } catch (err) {
    // No debería ocurrir: instrumentation valida el entorno al arrancar.
    console.error('[proxy] configuración inválida:', err instanceof Error ? err.message : err)
    return jsonError(500, 'Configuración del servidor inválida.')
  }

  const target = resolveTarget(request.url, backendOrigin)
  if (!target) return jsonError(400, 'Ruta inválida.')

  const method = request.method.toUpperCase()
  const hasBody = method !== 'GET' && method !== 'HEAD' && request.body !== null

  // Se cancela el upstream si el cliente se va (clave para SSE) o si vence el timeout de headers.
  const controller = new AbortController()
  const onClientAbort = () => controller.abort()
  if (request.signal.aborted) controller.abort()
  else request.signal.addEventListener('abort', onClientAbort, { once: true })

  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, getProxyTimeoutMs())

  try {
    const init: RequestInit & { duplex?: 'half' } = {
      method,
      headers: forwardRequestHeaders(request.headers),
      redirect: 'manual',
      signal: controller.signal,
    }
    if (hasBody) {
      init.body = request.body
      init.duplex = 'half'
    }

    const upstream = await fetch(target, init)
    // Llegaron los headers: desde acá el stream puede durar lo que necesite (SSE).
    clearTimeout(timer)

    const headers = forwardResponseHeaders(upstream.headers)
    if ((upstream.headers.get('content-type') ?? '').toLowerCase().includes('text/event-stream')) {
      headers.set('Cache-Control', 'no-cache, no-transform')
      headers.set('X-Accel-Buffering', 'no')
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    })
  } catch (err) {
    clearTimeout(timer)
    request.signal.removeEventListener('abort', onClientAbort)
    if (timedOut) return jsonError(504, 'El servidor tardó demasiado en responder.')
    if (request.signal.aborted) return new Response(null, { status: 499 }) // el cliente ya no está
    const cause = (err as { cause?: { code?: string } })?.cause?.code
    console.error(`[proxy] ${method} ${target.pathname} falló: ${cause ?? (err as Error)?.name ?? 'error'}`)
    return jsonError(502, 'No se pudo conectar con el servidor.')
  }
  // Ojo: en el camino feliz el listener de abort NO se quita al devolver el Response. Tiene que seguir
  // vivo mientras el stream (SSE) fluye para poder cortar el upstream cuando el cliente se desconecta.
  // Es de vida corta (atado a la request), no hay fuga.
}
