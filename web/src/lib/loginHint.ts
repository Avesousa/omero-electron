/**
 * Login con clave numérica — lado renderer. Este módulo decide qué modo de login ofrece el formulario:
 *
 *  - La PRIMERA vez en una caja el login es siempre email + contraseña (no hay pista guardada).
 *  - Tras un login exitoso se guarda la pista `{tenantId, quickKeyLoginEnabled}`: en desktop en el Next local
 *    (`/api/_local/login-hint`, archivo en el userData), en web en `localStorage`.
 *  - Los logins siguientes, si el negocio la tiene habilitada, aceptan en el mismo campo un email o una clave
 *    (`classifyIdentifier`). El flag se refresca contra el backend cuando hay conexión (`fetchLoginOptions`) y,
 *    sin conexión, vale el último conocido.
 */

export interface LoginHint {
  tenantId: string
  quickKeyLoginEnabled: boolean
}

export interface LoginOptions {
  quickKeyLoginEnabled: boolean
  quickKeyMinLength: number
  quickKeyMaxLength: number
}

/** Largos por defecto (los mismos que el backend) hasta saber los reales. */
export const DEFAULT_KEY_MIN = 6
export const DEFAULT_KEY_MAX = 10

const STORAGE_KEY = 'omero_login_hint'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const OPTIONS_TIMEOUT_MS = 5_000
/** El servidor local responde en ms; si no lo hace, se sigue sin la pista (login con email) en vez de esperar. */
const HINT_TIMEOUT_MS = 3_000

export type IdentifierKind = 'key' | 'email'

/**
 * `key` = solo dígitos ASCII con largo dentro de [min, max]; todo lo demás (incluido lo que tiene `@` o dígitos
 * incompletos) se trata como email. Sin el modo habilitado, el llamador ni siquiera debe consultar esto.
 */
export function classifyIdentifier(raw: string, min = DEFAULT_KEY_MIN, max = DEFAULT_KEY_MAX): IdentifierKind {
  const v = raw.trim()
  return /^[0-9]+$/.test(v) && v.length >= min && v.length <= max ? 'key' : 'email'
}

function parseHint(raw: unknown): LoginHint | null {
  if (raw === null || typeof raw !== 'object') return null
  const { tenantId, quickKeyLoginEnabled } = raw as Record<string, unknown>
  if (typeof tenantId !== 'string' || !UUID.test(tenantId)) return null
  return { tenantId: tenantId.toLowerCase(), quickKeyLoginEnabled: quickKeyLoginEnabled === true }
}

function readLocalStorage(): LoginHint | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? parseHint(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

function writeLocalStorage(hint: LoginHint): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(hint))
  } catch {
    /* modo privado / sin cuota: se pierde la comodidad, no el login */
  }
}

/** Pista guardada en esta caja, o null (primera vez). Nunca lanza. */
export async function loadLoginHint(): Promise<LoginHint | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HINT_TIMEOUT_MS)
  try {
    const res = await fetch('/api/_local/login-hint', { cache: 'no-store', signal: controller.signal })
    const body = (await res.json()) as { success?: boolean; data?: { available?: boolean; hint?: unknown } }
    if (body?.success && body.data?.available) return parseHint(body.data.hint)
  } catch {
    /* servidor local ausente, lento o respuesta inválida: se prueba el localStorage */
  } finally {
    clearTimeout(timer)
  }
  return readLocalStorage()
}

/** Guarda la pista tras un login exitoso. Best-effort: nunca lanza ni bloquea el login. */
export async function saveLoginHint(hint: LoginHint): Promise<void> {
  const clean = parseHint(hint)
  if (!clean) return
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HINT_TIMEOUT_MS)
  try {
    const res = await fetch('/api/_local/login-hint', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(clean),
      signal: controller.signal,
    })
    const body = (await res.json()) as { success?: boolean; data?: { available?: boolean } }
    if (body?.success && body.data?.available) return // desktop: quedó en el userData
  } catch {
    /* sin servidor local: localStorage */
  } finally {
    clearTimeout(timer)
  }
  writeLocalStorage(clean)
}

/** Opciones de login vigentes del negocio (público, sin sesión). null si no hay conexión o la respuesta no sirve. */
export async function fetchLoginOptions(tenantId: string): Promise<LoginOptions | null> {
  if (!UUID.test(tenantId)) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), OPTIONS_TIMEOUT_MS)
  try {
    const res = await fetch(`/api/auth/login-options/${tenantId}`, { cache: 'no-store', signal: controller.signal })
    if (!res.ok) return null
    const body = (await res.json()) as { success?: boolean; data?: Partial<LoginOptions> }
    if (!body?.success || !body.data || typeof body.data.quickKeyLoginEnabled !== 'boolean') return null
    return {
      quickKeyLoginEnabled: body.data.quickKeyLoginEnabled,
      quickKeyMinLength: Number(body.data.quickKeyMinLength) || DEFAULT_KEY_MIN,
      quickKeyMaxLength: Number(body.data.quickKeyMaxLength) || DEFAULT_KEY_MAX,
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
