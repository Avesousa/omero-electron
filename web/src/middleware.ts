import { NextRequest, NextResponse } from 'next/server'

const PUBLIC_ROUTES = ['/login']

/**
 * MODO WEB — sesión renovable: el JWT dura poco pero la sesión hasta 7 días con refresh token (que vive en localStorage,
 * ilegible para el middleware). Si el middleware rebotara a /login apenas vence la cookie `omero_session`, el cliente nunca
 * podría renovar. Por eso el cliente mantiene la cookie no sensible `omero_has_refresh=1` (Max-Age 7 días, deslizante) y, con
 * ella, el middleware deja pasar las rutas protegidas aunque el JWT haya vencido: el cliente renueva (apiFetch / AuthProvider)
 * o redirige a /login?reason=expired. No abre un agujero: la cookie no otorga acceso a datos (toda API valida el JWT en el
 * backend; falsificarla solo muestra el shell de la página). Es independiente de `omero_device_until` (caja de escritorio).
 */
const REFRESH_HINT_COOKIE = 'omero_has_refresh'

const BYPASS_PREFIXES = ['/_next', '/api', '/brand', '/favicon']

function decodePayload(token: string | undefined): { exp?: number; sub?: string } | null {
  if (!token) return null

  const parts = token.split('.')
  if (parts.length !== 3) return null

  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = atob(base64)
    return JSON.parse(json) as { exp?: number; sub?: string }
  } catch {
    return null
  }
}

function isValidJwt(token: string | undefined): boolean {
  const payload = decodePayload(token)
  if (!payload || typeof payload.exp !== 'number' || !payload.sub) return false

  const nowSeconds = Math.floor(Date.now() / 1000)
  return payload.exp > nowSeconds
}

/**
 * Caja con su sesión de 14 días vigente (cookie `omero_device_until`, ms epoch) y un JWT bien formado pero vencido: se deja
 * pasar para que el cliente lo renueve (o trabaje sin internet) en vez de mandar al login. La cookie solo habilita la
 * pantalla; el backend valida siempre el JWT, así que una cookie falsificada no da acceso a datos.
 */
function isDeviceSessionWithExpiredJwt(token: string | undefined, untilRaw: string | undefined): boolean {
  const until = untilRaw ? Number(untilRaw) : NaN
  if (!Number.isFinite(until) || until <= Date.now()) return false
  const payload = decodePayload(token)
  return !!payload && typeof payload.exp === 'number' && !!payload.sub
}


export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (BYPASS_PREFIXES.some(prefix => pathname.startsWith(prefix))) {
    return NextResponse.next()
  }

  const sessionToken = request.cookies.get('omero_session')?.value
  const deviceUntil = request.cookies.get('omero_device_until')?.value
  const hasValidJwt = isValidJwt(sessionToken)
  const hasValidSession = hasValidJwt || isDeviceSessionWithExpiredJwt(sessionToken, deviceUntil)
  const hasRefreshHint = request.cookies.get(REFRESH_HINT_COOKIE)?.value === '1'
  const isPublicRoute = PUBLIC_ROUTES.includes(pathname)

  if (isPublicRoute && hasValidSession) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  if (!isPublicRoute && !hasValidSession && !hasRefreshHint) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirectTo', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
