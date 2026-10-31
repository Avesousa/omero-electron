import { NextRequest, NextResponse } from 'next/server'

const PUBLIC_ROUTES = ['/login']

const BYPASS_PREFIXES = ['/_next', '/api', '/brand', '/favicon']

function isValidJwt(token: string | undefined): boolean {
  if (!token) return false

  const parts = token.split('.')
  if (parts.length !== 3) return false

  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = atob(base64)
    const payload = JSON.parse(json) as { exp?: number; sub?: string }

    if (typeof payload.exp !== 'number' || !payload.sub) return false

    const nowSeconds = Math.floor(Date.now() / 1000)
    if (payload.exp <= nowSeconds) return false

    return true
  } catch {
    return false
  }
}


export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (BYPASS_PREFIXES.some(prefix => pathname.startsWith(prefix))) {
    return NextResponse.next()
  }

  const sessionToken = request.cookies.get('omero_session')?.value
  const hasValidSession = isValidJwt(sessionToken)
  const isPublicRoute = PUBLIC_ROUTES.includes(pathname)

  if (isPublicRoute && hasValidSession) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  if (!isPublicRoute && !hasValidSession) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirectTo', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
