import type { User } from '@/shared/types/auth'

const TOKEN_KEY = 'omero_auth_token'
const USER_KEY = 'omero_auth_user'
const COOKIE_NAME = 'omero_session'
const USER_COOKIE_NAME = 'omero_user'
/** Fin (ms epoch) de la sesión de 14 días de la caja. Solo existe con identidad de caja confirmada por el servidor local. */
const DEVICE_UNTIL_COOKIE = 'omero_device_until'

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
  writeCookie(DEVICE_UNTIL_COOKIE, '', 0)
}

/**
 * Fin de la sesión de 14 días de la caja (ms epoch) si hay una vigente en este equipo; null si no hay caja o ya terminó.
 * Mientras esté vigente, un JWT vencido NO cierra la sesión en pantalla: la caja puede estar sin conexión y el JWT se
 * renueva (renovación obligatoria) cuando haga falta. La cookie solo habilita la pantalla: el backend valida siempre el JWT.
 */
export function deviceSessionUntil(): number | null {
  try {
    const raw = readCookie(DEVICE_UNTIL_COOKIE)
    const until = raw ? Number(raw) : NaN
    return Number.isFinite(until) && until > Date.now() ? until : null
  } catch {
    return null
  }
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
  // Con sesión de caja vigente se rehidrata aunque el JWT haya vencido (la renovación lo reemplaza); sin caja, no.
  if (!payload || (isExpired(payload.exp) && deviceSessionUntil() === null)) return
  try {
    sessionStorage.setItem(USER_KEY, decodeURIComponent(user))
    sessionStorage.setItem(TOKEN_KEY, jwt)
  } catch {
    // cookie corrupta: se ignora y el usuario deberá iniciar sesión
  }
}

export function setSession(jwt: string, user: User, deviceUntilMs?: number | null): void {
  const payload = decodeJwtExp(jwt)
  if (!payload) throw new Error('[sessionManager] JWT malformado')

  const remainingSeconds = payload.exp - Math.floor(Date.now() / 1000)

  sessionStorage.setItem(TOKEN_KEY, jwt)
  sessionStorage.setItem(USER_KEY, JSON.stringify(user))
  writeCookie(COOKIE_NAME, jwt, remainingSeconds)
  writeCookie(USER_COOKIE_NAME, encodeURIComponent(JSON.stringify(user)), remainingSeconds)
  // Una renovación conserva el fin de la sesión de caja ya conocido si no trae uno nuevo.
  const until = deviceUntilMs ?? deviceSessionUntil()
  if (until) setDeviceSessionUntil(until)
}

/**
 * Marca que esta sesión pertenece a una caja con sesión de 14 días hasta `untilMs`: la cookie de fin y las de sesión pasan
 * a durar hasta entonces, para que un JWT vencido (p. ej. sin internet) no mande al login ni borre la sesión. Solo debe
 * llamarse con identidad de caja confirmada por el servidor local. Sin sesión guardada o con un fin pasado no hace nada.
 */
export function setDeviceSessionUntil(untilMs: number): void {
  try {
    const maxAge = Math.floor((untilMs - Date.now()) / 1000)
    if (!Number.isFinite(maxAge) || maxAge <= 0) return
    const jwt = sessionStorage.getItem(TOKEN_KEY)
    const user = sessionStorage.getItem(USER_KEY)
    if (!jwt || !user) return
    writeCookie(DEVICE_UNTIL_COOKIE, String(Math.floor(untilMs)), maxAge)
    writeCookie(COOKIE_NAME, jwt, maxAge)
    writeCookie(USER_COOKIE_NAME, encodeURIComponent(user), maxAge)
  } catch {
    /* cookies bloqueadas: la sesión sigue como antes (el JWT vencido manda al login) */
  }
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
    // JWT vencido: cierra la sesión salvo que sea una caja con su sesión de 14 días vigente (se renueva sola al operar).
    if (!payload || (isExpired(payload.exp) && deviceSessionUntil() === null)) {
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
