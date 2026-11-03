import type { User } from '@/shared/types/auth'

const TOKEN_KEY = 'omero_auth_token'
const USER_KEY = 'omero_auth_user'
const REFRESH_KEY = 'omero_refresh_token'
const COOKIE_NAME = 'omero_session'
const USER_COOKIE_NAME = 'omero_user'
/** Cookie NO sensible (solo "1"): avisa al middleware que hay una sesión renovable. Ver middleware.ts. */
export const REFRESH_HINT_COOKIE = 'omero_has_refresh'
/**
 * Fin (ms epoch) de la sesión de 14 días de la CAJA de escritorio. Solo existe con identidad de caja confirmada por el servidor
 * local. Es un mecanismo DISTINTO del refresh token web: una caja nunca guarda refresh token ni `omero_has_refresh`.
 */
const DEVICE_UNTIL_COOKIE = 'omero_device_until'

/** Ventana deslizante del refresh token web en el backend (7 días). Solo modo web (sin caja). */
const REFRESH_WINDOW_SECONDS = 7 * 24 * 60 * 60
/** Por debajo de este margen un JWT se considera "por vencer". */
const RENEW_THRESHOLD_SECONDS = 5 * 60
/** La renovación proactiva dispara cuando faltan ~60 s. */
const PROACTIVE_LEAD_SECONDS = 60
/** Hubo actividad del usuario "reciente" si ocurrió en los últimos 10 min. */
const ACTIVITY_WINDOW_MS = 10 * 60 * 1000
const TICK_MS = 15 * 1000
/** Reintentos ante fallo de red (backoff). */
export const REFRESH_RETRY_DELAYS_MS = [1000, 3000]

export type SessionLostReason = 'replaced' | 'expired'

export type RefreshResult =
  | { ok: true }
  | { ok: false; reason: 'replaced' | 'invalid' | 'none' | 'network' }

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

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function isExpired(exp: number): boolean {
  return exp <= nowSeconds()
}

function writeCookie(name: string, value: string, maxAgeSeconds: number): void {
  document.cookie = [`${name}=${value}`, 'Path=/', 'SameSite=Strict', `Max-Age=${maxAgeSeconds}`].join('; ')
}

function readCookie(name: string): string | null {
  const match = document.cookie.split('; ').find(c => c.startsWith(`${name}=`))
  return match ? match.slice(name.length + 1) : null
}

/* ── Refresh token: localStorage (compartido entre pestañas) con respaldo en memoria ── */

let memoryRefreshToken: string | null = null

function getRefreshToken(): string | null {
  try {
    const v = localStorage.getItem(REFRESH_KEY)
    if (v) return v
  } catch {
    // localStorage puede fallar (modo privado, datos bloqueados): se usa la memoria
  }
  return memoryRefreshToken
}

function storeRefreshToken(token: string): void {
  memoryRefreshToken = token
  try {
    localStorage.setItem(REFRESH_KEY, token)
  } catch {
    // ver arriba
  }
}

function removeRefreshToken(): void {
  memoryRefreshToken = null
  try {
    localStorage.removeItem(REFRESH_KEY)
  } catch {
    // ver arriba
  }
}

export function hasRefreshToken(): boolean {
  return !!getRefreshToken()
}

/** ¿La cookie-señal indica que el middleware dejó pasar por una sesión renovable? */
export function hasRefreshHint(): boolean {
  try {
    return readCookie(REFRESH_HINT_COOKIE) === '1'
  } catch {
    return false
  }
}

function writeSessionCookies(jwt: string, userJson: string | null): void {
  const payload = decodeJwtExp(jwt)
  if (!payload) return
  const remaining = Math.max(0, payload.exp - nowSeconds())
  writeCookie(COOKIE_NAME, jwt, remaining)
  if (hasRefreshToken()) {
    // Modo web: la sesión es renovable (refresh token) y sobrevive al JWT.
    writeCookie(REFRESH_HINT_COOKIE, '1', REFRESH_WINDOW_SECONDS)
    // El usuario sobrevive al JWT para que una pestaña nueva pueda renovar.
    if (userJson) writeCookie(USER_COOKIE_NAME, encodeURIComponent(userJson), REFRESH_WINDOW_SECONDS)
  } else if (userJson) {
    writeCookie(USER_COOKIE_NAME, encodeURIComponent(userJson), remaining)
  }
}

function clearCookies(): void {
  writeCookie(COOKIE_NAME, '', 0)
  writeCookie(USER_COOKIE_NAME, '', 0)
  writeCookie(REFRESH_HINT_COOKIE, '', 0)
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
 * El mejor JWT disponible: el de sessionStorage o el de la cookie (que otra pestaña pudo haber
 * renovado), el de mayor exp. Si gana el de la cookie, se adopta en sessionStorage.
 */
function currentJwt(): { jwt: string; exp: number } | null {
  let best: { jwt: string; exp: number } | null = null
  const candidates: (string | null)[] = []
  try {
    candidates.push(sessionStorage.getItem(TOKEN_KEY))
  } catch {
    candidates.push(null)
  }
  const cookieJwt = readCookie(COOKIE_NAME)
  candidates.push(cookieJwt)
  for (const jwt of candidates) {
    if (!jwt) continue
    const p = decodeJwtExp(jwt)
    if (p && (!best || p.exp > best.exp)) best = { jwt, exp: p.exp }
  }
  if (best && best.jwt === cookieJwt && !isExpired(best.exp)) {
    try {
      if (sessionStorage.getItem(TOKEN_KEY) !== best.jwt) sessionStorage.setItem(TOKEN_KEY, best.jwt)
    } catch {
      // ignorar
    }
  }
  return best
}

/**
 * sessionStorage es por pestaña: una pestaña nueva (p. ej. el POS abierto desde el menú de admin)
 * llega sin token aunque la sesión siga vigente. Se rehidrata desde las cookies de sesión; si el JWT
 * ya venció pero hay refresh token (modo web), se rehidrata solo el usuario (el token se renueva después).
 * Con sesión de caja vigente se rehidrata aunque el JWT haya vencido (la renovación lo reemplaza).
 */
function hydrateFromCookies(): void {
  if (sessionStorage.getItem(TOKEN_KEY)) return
  const jwt = readCookie(COOKIE_NAME)
  const user = readCookie(USER_COOKIE_NAME)
  if (!user) return
  try {
    const payload = jwt ? decodeJwtExp(jwt) : null
    if (jwt && payload && (!isExpired(payload.exp) || deviceSessionUntil() !== null)) {
      sessionStorage.setItem(USER_KEY, decodeURIComponent(user))
      sessionStorage.setItem(TOKEN_KEY, jwt)
    } else if (hasRefreshToken() && !sessionStorage.getItem(USER_KEY)) {
      sessionStorage.setItem(USER_KEY, decodeURIComponent(user))
    }
  } catch {
    // cookie corrupta: se ignora y el usuario deberá iniciar sesión
  }
}

/**
 * Guarda la sesión. `refreshToken`: string = modo web (se guarda y la sesión pasa a ser renovable); `null` = login de CAJA
 * (se descarta cualquier refresh token: la caja usa su sesión de dispositivo, nunca el refresh web); undefined = renovación
 * (conserva lo que haya).
 */
export function setSession(jwt: string, user: User, refreshToken?: string | null, deviceUntilMs?: number | null): void {
  const payload = decodeJwtExp(jwt)
  if (!payload) throw new Error('[sessionManager] JWT malformado')

  sessionLostHandled = false
  if (refreshToken) storeRefreshToken(refreshToken)
  else if (refreshToken === null) removeRefreshToken()
  const userJson = JSON.stringify(user)
  sessionStorage.setItem(TOKEN_KEY, jwt)
  sessionStorage.setItem(USER_KEY, userJson)
  writeSessionCookies(jwt, userJson)
  // Una renovación de caja conserva el fin de la sesión ya conocido si no trae uno nuevo.
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

/** Cierra la sesión local (web Y caja). No toca nada ajeno a la sesión (p. ej. borradores `omero_draft:`). */
export function clearSession(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY)
    sessionStorage.removeItem(USER_KEY)
  } catch {
    // ignorar
  }
  removeRefreshToken()
  clearCookies()
}

export function getAuthToken(): string | null {
  try {
    hydrateFromCookies()
    const cur = currentJwt()
    if (!cur || isExpired(cur.exp)) return null
    return cur.jwt
  } catch {
    return null
  }
}

/** `exp` (segundos epoch) del JWT guardado, aunque ya haya vencido; null si no hay sesión. */
export function getSessionExpiry(): number | null {
  try {
    hydrateFromCookies()
    const cur = currentJwt()
    return cur ? cur.exp : null
  } catch {
    return null
  }
}

/** Refresh token actual (para el logout contra el backend). Siempre null en una caja. */
export function getStoredRefreshToken(): string | null {
  return getRefreshToken()
}

/** Authorization header for the current session, or an empty object when there is none. */
export function authHeaders(): Record<string, string> {
  const jwt = getAuthToken()
  return jwt ? { Authorization: `Bearer ${jwt}` } : {}
}

export function getSessionUser(): User | null {
  try {
    hydrateFromCookies()
    const cur = currentJwt()
    const jwtValid = !!cur && !isExpired(cur.exp)
    // Sigue siendo recuperable con refresh token (web) o con la sesión de 14 días de la caja vigente.
    if (!jwtValid && !hasRefreshToken() && deviceSessionUntil() === null) {
      if (cur) clearSession()
      return null
    }

    const raw = sessionStorage.getItem(USER_KEY)
    if (!raw) return null
    return JSON.parse(raw) as User
  } catch {
    return null
  }
}

/* ── Renovación (refresh) ─────────────────────────────────────────────────── */

let inflight: Promise<RefreshResult> | null = null

async function withCrossTabLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined
  if (locks?.request) return (await locks.request('omero-refresh', fn)) as T
  return fn()
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

type Attempt = { kind: 'ok'; accessToken: string; refreshToken: string } | { kind: 'fail'; reason: 'replaced' | 'invalid' | 'network' }

async function callRefreshEndpoint(refreshToken: string): Promise<Attempt> {
  let res: Response
  try {
    res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })
  } catch {
    return { kind: 'fail', reason: 'network' }
  }

  let body: { code?: string; data?: { accessToken?: string; refreshToken?: string }; accessToken?: string; refreshToken?: string } | null = null
  try {
    body = JSON.parse(await res.text())
  } catch {
    body = null
  }

  if (res.ok) {
    const data = body?.data ?? body
    if (data?.accessToken && data?.refreshToken && decodeJwtExp(data.accessToken)) {
      return { kind: 'ok', accessToken: data.accessToken, refreshToken: data.refreshToken }
    }
    return { kind: 'fail', reason: 'network' } // respuesta inesperada: no se cierra la sesión
  }
  if (res.status === 401) {
    return { kind: 'fail', reason: body?.code === 'SESSION_REPLACED' ? 'replaced' : 'invalid' }
  }
  return { kind: 'fail', reason: 'network' } // 5xx, 429, 403 del proxy, etc.: transitorio
}

async function doRefresh(staleToken?: string): Promise<RefreshResult> {
  // Otra pestaña pudo renovar mientras esperábamos el lock: releer antes de llamar al backend.
  const cur = currentJwt()
  if (cur) {
    const remaining = cur.exp - nowSeconds()
    const renewedByOther = staleToken
      ? cur.jwt !== staleToken && remaining > PROACTIVE_LEAD_SECONDS
      : remaining > RENEW_THRESHOLD_SECONDS
    if (renewedByOther) return { ok: true }
  }

  for (let attempt = 0; ; attempt++) {
    const refreshToken = getRefreshToken()
    if (!refreshToken) return { ok: false, reason: 'none' }

    const result = await callRefreshEndpoint(refreshToken)
    if (result.kind === 'ok') {
      storeRefreshToken(result.refreshToken) // el refresh token rota: siempre se guarda el nuevo
      try {
        sessionStorage.setItem(TOKEN_KEY, result.accessToken)
      } catch {
        // ignorar
      }
      let userJson: string | null = null
      try {
        userJson = sessionStorage.getItem(USER_KEY)
      } catch {
        // ignorar
      }
      writeSessionCookies(result.accessToken, userJson)
      return { ok: true }
    }
    if (result.reason !== 'network') return { ok: false, reason: result.reason }
    if (attempt >= REFRESH_RETRY_DELAYS_MS.length) return { ok: false, reason: 'network' }
    await sleep(REFRESH_RETRY_DELAYS_MS[attempt])
  }
}

/**
 * Renueva el access token con el refresh token. Single-flight dentro de la pestaña y exclusión
 * mutua entre pestañas (Web Locks). Un fallo de red NO cierra la sesión; ese juicio (y el de
 * `replaced`/`invalid`) lo toma el llamador con {@link handleSessionLost}.
 *
 * @param staleToken JWT con el que falló una request (401): evita saltear la renovación cuando
 *   el JWT "vigente" es justamente el que el backend rechazó.
 */
export function refreshSession(staleToken?: string): Promise<RefreshResult> {
  if (inflight) return inflight
  const p = withCrossTabLock(() => doRefresh(staleToken)).finally(() => {
    if (inflight === p) inflight = null
  })
  inflight = p
  return p
}

let sessionLostHandled = false

/**
 * La sesión se perdió definitivamente: limpia y manda a /login con el motivo. Idempotente, y sin
 * recarga si ya estamos en /login. `reason: null` = cierre voluntario en otra pestaña (sin aviso).
 */
export function handleSessionLost(reason: SessionLostReason | null): void {
  if (sessionLostHandled) return
  sessionLostHandled = true
  stopSessionRenewal()
  clearSession()
  if (typeof window === 'undefined') return
  if (window.location.pathname?.startsWith('/login')) return
  window.location.href = reason ? `/login?reason=${reason}` : '/login'
}

export function lostReasonFrom(result: Extract<RefreshResult, { ok: false }>): SessionLostReason {
  return result.reason === 'replaced' ? 'replaced' : 'expired'
}

/**
 * Headers de autorización esperando una renovación si el JWT venció o está por vencer. `null`
 * significa que la sesión se perdió (ya se redirigió a /login): no hay que mandar la request.
 * Una request sin token nunca provoca logout por sí sola: primero se intenta el refresh.
 */
export async function getFreshAuthHeaders(): Promise<Record<string, string> | null> {
  markActivity()
  try {
    hydrateFromCookies()
  } catch {
    // ignorar
  }
  const cur = currentJwt()
  if (cur && cur.exp - nowSeconds() > 30) return { Authorization: `Bearer ${cur.jwt}` }
  if (!hasRefreshToken()) return authHeaders()

  const r = await refreshSession()
  if (r.ok) return authHeaders()
  if (r.reason === 'network') return authHeaders()
  handleSessionLost(lostReasonFrom(r))
  return null
}

/* ── Renovación proactiva ─────────────────────────────────────────────────── */

let lastActivityAt = 0
let renewalCleanup: (() => void) | null = null

export function markActivity(): void {
  lastActivityAt = Date.now()
}

function hadRecentActivity(): boolean {
  return Date.now() - lastActivityAt < ACTIVITY_WINDOW_MS
}

export function stopSessionRenewal(): void {
  renewalCleanup?.()
  renewalCleanup = null
}

/**
 * Arranca la renovación proactiva (idempotente):
 * - un timer renueva ~1 min antes del vencimiento SOLO si hubo actividad en los últimos 10 min;
 * - al volver a la pestaña renueva si el JWT venció o vence en <5 min;
 * - escucha cambios del refresh token en otras pestañas (rotación o cierre de sesión).
 */
export function startSessionRenewal(): () => void {
  if (typeof window === 'undefined') return () => {}
  stopSessionRenewal()
  markActivity()

  let busy = false
  let nextAttemptAt = 0
  let failures = 0

  const renew = async () => {
    if (busy || !hasRefreshToken()) return
    busy = true
    try {
      const r = await refreshSession()
      if (r.ok) {
        failures = 0
        nextAttemptAt = 0
      } else if (r.reason === 'network') {
        failures++
        nextAttemptAt = Date.now() + Math.min(2 * 60_000, 15_000 * 2 ** failures)
      } else {
        handleSessionLost(lostReasonFrom(r))
      }
    } finally {
      busy = false
    }
  }

  const tick = () => {
    if (Date.now() < nextAttemptAt) return
    const cur = currentJwt()
    if (!cur) return
    if (cur.exp - nowSeconds() <= PROACTIVE_LEAD_SECONDS && hadRecentActivity()) void renew()
  }

  const onVisible = () => {
    if (document.visibilityState === 'hidden') return
    markActivity()
    const cur = currentJwt()
    if (!cur || cur.exp - nowSeconds() < RENEW_THRESHOLD_SECONDS) {
      nextAttemptAt = 0
      void renew()
    }
  }

  let lastMark = 0
  const onActivity = () => {
    const t = Date.now()
    if (t - lastMark < 1000) return
    lastMark = t
    markActivity()
  }

  const onStorage = (e: StorageEvent) => {
    if (e.key !== REFRESH_KEY) return
    if (e.newValue) {
      currentJwt() // adopta el JWT que la otra pestaña dejó en la cookie
    } else {
      handleSessionLost(null) // otra pestaña cerró sesión (o la perdió)
    }
  }

  const interval = setInterval(tick, TICK_MS)
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('focus', onVisible)
  window.addEventListener('storage', onStorage)
  const opts = { passive: true } as AddEventListenerOptions
  const events = ['pointerdown', 'keydown', 'scroll'] as const
  events.forEach(ev => window.addEventListener(ev, onActivity, opts))

  renewalCleanup = () => {
    clearInterval(interval)
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('focus', onVisible)
    window.removeEventListener('storage', onStorage)
    events.forEach(ev => window.removeEventListener(ev, onActivity, opts))
  }
  return stopSessionRenewal
}
