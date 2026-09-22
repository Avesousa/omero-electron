import { proxyToBackend } from '../backend-proxy'
import { getDeviceState } from './device-state'

/**
 * Login del POS desktop (fase 4): `POST /api/auth/login` se intercepta para registrar la caja.
 *
 *  - Se agrega `device{deviceId,name,platform,appVersion}` al cuerpo (lo conoce Electron; el renderer no).
 *  - El backend responde el `deviceSecret`: se guarda en memoria (y Electron lo persiste cifrado) y se QUITA de la
 *    respuesta: el secreto nunca llega al renderer.
 *  - Sin identidad de caja (web, dev sin Electron), cuerpo que no es JSON u objeto inválido → proxy directo, sin tocar.
 *  - Un backend viejo no devuelve `deviceSecret`: la respuesta pasa igual (sin sesión larga).
 */

export function isLoginRoute(method: string, pathname: string): boolean {
  return method.toUpperCase() === 'POST' && pathname.replace(/\/+$/, '') === '/api/auth/login'
}

export async function handleLogin(request: Request): Promise<Response> {
  const state = getDeviceState()
  const identity = state.identity
  if (!identity) return proxyToBackend(request)

  let credentials: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(await request.clone().text())
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return proxyToBackend(request)
    credentials = parsed as Record<string, unknown>
  } catch {
    return proxyToBackend(request)
  }

  const headers = new Headers(request.headers)
  headers.delete('content-length')
  const upstream = await proxyToBackend(
    new Request(request.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...credentials,
        device: { deviceId: identity.deviceId, name: identity.name, platform: identity.platform, appVersion: identity.appVersion },
      }),
    }),
  )
  if (upstream.status !== 200) return upstream

  const text = await upstream.text()
  try {
    const body = JSON.parse(text) as { data?: { deviceSecret?: unknown; user?: { tenantId?: unknown } } }
    const secret = body?.data?.deviceSecret
    const tenantId = body?.data?.user?.tenantId
    if (typeof secret === 'string' && typeof tenantId === 'string') {
      state.set(tenantId, secret, true)
      delete body.data!.deviceSecret // el renderer nunca ve el secreto
      const out = new Headers(upstream.headers)
      out.delete('content-length')
      return new Response(JSON.stringify(body), { status: 200, statusText: upstream.statusText, headers: out })
    }
  } catch {
    /* respuesta no JSON: se devuelve tal cual */
  }
  const out = new Headers(upstream.headers)
  out.delete('content-length')
  return new Response(text, { status: upstream.status, statusText: upstream.statusText, headers: out })
}
