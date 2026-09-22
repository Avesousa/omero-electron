import type { User } from '@/shared/types/auth'

const TOKEN_KEY = 'omero_auth_token'
const USER_KEY = 'omero_auth_user'
const COOKIE_NAME = 'omero_session'
const USER_COOKIE_NAME = 'omero_user'

interface JwtExpPayload {
  exp: number
}

function decodeJwtExp(jwt: string): JwtExpPayload | null {
  try {
    const parts = jwt.split('.')
    if (parts.length !== 3) return null
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = atob(base64)
    const payload = JSON.parse(json)
    if (typeof payload.exp !== 'number') return null
    return { exp: payload.exp }
  } catch {
    return null
  }
}

function isExpired(exp: number): boolean {
  return exp <= Math.floor(Date.now() / 1000)
}

function writeCookie(name: string, value: string, maxAgeSeconds: number): void {
  document.cookie = [`${name}=${value}`, 'Path=/', 'SameSite=Strict', `Max-Age=${maxAgeSeconds}`].join('; ')
}

function readCookie(name: string): string | null {
  const match = document.cookie.split('; ').find(c => c.startsWith(`${name}=`))
  return match ? match.slice(name.length + 1) : null
}

function clearCookies(): void {
  writeCookie(COOKIE_NAME, '', 0)
  writeCookie(USER_COOKIE_NAME, '', 0)
}

/**
 * sessionStorage es por pestaña: una pestaña nueva (p. ej. el POS abierto desde el menú de admin)
 * llega sin token aunque la sesión siga vigente. Se rehidrata desde las cookies de sesión.
 */
function hydrateFromCookies(): void {
  if (sessionStorage.getItem(TOKEN_KEY)) return
  const jwt = readCookie(COOKIE_NAME)
  const user = readCookie(USER_COOKIE_NAME)
  if (!jwt || !user) return
  const payload = decodeJwtExp(jwt)
  if (!payload || isExpired(payload.exp)) return
  try {
    sessionStorage.setItem(USER_KEY, decodeURIComponent(user))
    sessionStorage.setItem(TOKEN_KEY, jwt)
  } catch {
    // cookie corrupta: se ignora y el usuario deberá iniciar sesión
  }
}

export function setSession(jwt: string, user: User): void {
  const payload = decodeJwtExp(jwt)
  if (!payload) throw new Error('[sessionManager] JWT malformado')

  const remainingSeconds = payload.exp - Math.floor(Date.now() / 1000)

  sessionStorage.setItem(TOKEN_KEY, jwt)
  sessionStorage.setItem(USER_KEY, JSON.stringify(user))
  writeCookie(COOKIE_NAME, jwt, remainingSeconds)
  writeCookie(USER_COOKIE_NAME, encodeURIComponent(JSON.stringify(user)), remainingSeconds)
}

export function clearSession(): void {
  sessionStorage.removeItem(TOKEN_KEY)
  sessionStorage.removeItem(USER_KEY)
  clearCookies()
}

export function getAuthToken(): string | null {
  try {
    hydrateFromCookies()
    const jwt = sessionStorage.getItem(TOKEN_KEY)
    if (!jwt) return null
    const payload = decodeJwtExp(jwt)
    if (!payload || isExpired(payload.exp)) return null
    return jwt
  } catch {
    return null
  }
}

/** `exp` (segundos epoch) del JWT guardado, aunque ya haya vencido; null si no hay sesión. Sirve para agendar la renovación. */
export function getSessionExpiry(): number | null {
  try {
    hydrateFromCookies()
    const jwt = sessionStorage.getItem(TOKEN_KEY)
    return jwt ? (decodeJwtExp(jwt)?.exp ?? null) : null
  } catch {
    return null
  }
}

/** Authorization header for the current session, or an empty object when there is none. */
export function authHeaders(): Record<string, string> {
  const jwt = getAuthToken()
  return jwt ? { Authorization: `Bearer ${jwt}` } : {}
}

export function getSessionUser(): User | null {
  try {
    hydrateFromCookies()
    const jwt = sessionStorage.getItem(TOKEN_KEY)
    if (!jwt) return null

    const payload = decodeJwtExp(jwt)
    if (!payload || isExpired(payload.exp)) {
      clearSession()
      return null
    }

    const raw = sessionStorage.getItem(USER_KEY)
    if (!raw) return null
    return JSON.parse(raw) as User
  } catch {
    return null
  }
}
