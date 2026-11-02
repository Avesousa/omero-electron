import { DeviceClient, type DeviceFailure, type DeviceUser } from './device-client'
import { getDeviceState, type DeviceState } from './device-state'

/**
 * Orquesta la sesión de la caja para un tenant: renovar (`refresh`), pedir el token de solo-subida (`syncToken`) y
 * cerrar sesión. Un solo refresh en vuelo por tenant: el secreto ROTA en cada renovación, dos concurrentes se pisarían.
 * Los secretos nunca salen de acá (ni al renderer ni a los logs).
 */

export type SessionCode =
  | 'NO_DEVICE' // no hay secreto de caja (web, backend viejo, nunca activada)
  | 'LOGIN_REQUIRED'
  | 'DEVICE_EXPIRED'
  | 'DEVICE_REVOKED'
  | 'DEVICE_SECRET_INVALID'
  | 'SYNC_WINDOW_CLOSED'
  | 'UNAVAILABLE'

export interface SessionFailure {
  ok: false
  code: SessionCode
  message: string
}
export interface SessionRefreshed {
  ok: true
  accessToken: string
  expiresIn: number
  user: DeviceUser
  /** Vencimiento de la sesión de 14 días (ms epoch), si el backend lo informó. */
  sessionExpiresAt: number | null
}
export interface SessionSyncToken {
  ok: true
  accessToken: string
  expiresIn: number
}

/** Lo mínimo que se le pide al CatalogSyncer: guardar el token vigente en memoria. */
export interface TokenSink {
  remember(tenantId: string, authorization: string): void
}

export interface DeviceSessionDeps {
  state?: DeviceState
  client?: DeviceClient
  sink?: TokenSink
  now?: () => number
}

/**
 * Cada cuánto (como mucho) se valida la sesión de la caja contra el backend. La sesión dura 14 días y cada renovación
 * (`refresh`) vuelve a dar 14. La validación es PASIVA: la dispara una operación de la caja, nunca un reloj.
 */
export const VALIDATION_INTERVAL_MS = 24 * 3600_000

/** Códigos que terminan la sesión de la caja de forma definitiva (no se arreglan reintentando). */
export type EndedCode = 'DEVICE_REVOKED' | 'DEVICE_EXPIRED' | 'LOGIN_REQUIRED'
export const ENDED_MESSAGES: Record<EndedCode, string> = {
  DEVICE_REVOKED: 'Esta caja fue revocada por un administrador.',
  DEVICE_EXPIRED: 'Esta caja estuvo 14 días sin conectarse. Ingresá de nuevo.',
  LOGIN_REQUIRED: 'Iniciá sesión para seguir.',
}

const KNOWN: readonly SessionCode[] = ['LOGIN_REQUIRED', 'DEVICE_EXPIRED', 'DEVICE_REVOKED', 'DEVICE_SECRET_INVALID', 'SYNC_WINDOW_CLOSED']

function fail(code: SessionCode, message: string): SessionFailure {
  return { ok: false, code, message }
}

function toFailure(f: DeviceFailure): SessionFailure {
  const code = (KNOWN as readonly string[]).includes(f.code) ? (f.code as SessionCode) : 'UNAVAILABLE'
  return fail(code, f.message)
}

export class DeviceSession {
  private readonly inFlight = new Map<string, Promise<SessionRefreshed | SessionFailure>>()
  private readonly deps: { state: () => DeviceState; client: DeviceClient; now: () => number }
  private sink: TokenSink | null

  constructor(deps: DeviceSessionDeps = {}) {
    this.deps = { state: () => deps.state ?? getDeviceState(), client: deps.client ?? new DeviceClient(), now: deps.now ?? Date.now }
    this.sink = deps.sink ?? null
  }

  /** Dónde dejar el JWT renovado (el CatalogSyncer). Se cablea desde `device-wiring` (evita un ciclo de imports). */
  setSink(sink: TokenSink): void {
    this.sink = sink
  }

  get state(): DeviceState {
    return this.deps.state()
  }

  /** Renueva el JWT (`scope=pos`) con el secreto de la caja. Comparte el intento en vuelo del mismo tenant. */
  refresh(tenantId: string): Promise<SessionRefreshed | SessionFailure> {
    const key = tenantId.toLowerCase()
    const running = this.inFlight.get(key)
    if (running) return running
    const attempt = this.doRefresh(key).finally(() => this.inFlight.delete(key))
    this.inFlight.set(key, attempt)
    return attempt
  }

  private async doRefresh(tenantId: string): Promise<SessionRefreshed | SessionFailure> {
    const state = this.state
    const entry = state.get(tenantId)
    if (!entry) return fail('NO_DEVICE', 'Esta caja no tiene sesión de dispositivo')
    if (!entry.sessionActive) return fail('LOGIN_REQUIRED', 'Hay que iniciar sesión')

    // Ya se supo (en una renovación anterior) o que pasaron los 14 días sin renovar que el backend cerró esta sesión: no insistir en cada request.
    const ended = state.endedReason(tenantId)
    if (ended && ended !== 'LOGIN_REQUIRED') return fail(ended, ENDED_MESSAGES[ended])

    const r = await this.deps.client.refresh(entry.secret)
    if (r.ok) {
      const now = this.deps.now()
      const exp = Date.parse(r.deviceExpiresAt)
      const sessionExpiresAt = Number.isFinite(exp) ? exp : null
      // El secreto ROTÓ y el anterior ya no sirve: se espera a que Electron confirme que el nuevo quedó en disco antes de seguir.
      await state.setDurable(tenantId, r.deviceSecret, { lastCheckedAt: now, expiresAt: sessionExpiresAt })
      this.sink?.remember(tenantId, `Bearer ${r.accessToken}`)
      return { ok: true, accessToken: r.accessToken, expiresIn: r.expiresIn, user: r.user, sessionExpiresAt }
    }
    const failure = toFailure(r)
    // El backend ya no acepta renovar con esta sesión: no insistir en cada request.
    if (failure.code === 'LOGIN_REQUIRED') state.markLoggedOut(tenantId)
    if (failure.code === 'LOGIN_REQUIRED' || failure.code === 'DEVICE_REVOKED' || failure.code === 'DEVICE_EXPIRED') state.markEnded(tenantId, failure.code)
    if (failure.code === 'DEVICE_SECRET_INVALID') state.remove(tenantId)
    return failure
  }

  /**
   * Validador pasivo: si pasaron >= 24 h desde la última validación, renueva la sesión de la caja AHORA (single-flight).
   * Lo llaman las operaciones que ya existen (arranque, requests, ciclo del outbox/syncer). Nunca lanza.
   *  - Éxito: `refresh` ya guardó `lastCheckedAt`, el nuevo `expiresAt` (+14 días) y el secreto rotado.
   *  - Falla transitoria (red, timeout, 5xx): no se corta nada ni se toca el secreto; se anota `lastCheckedAt = ahora` para no
   *    volver a validar hasta dentro de 24 h (sin reintentos ni backoff). La `expiresAt` queda la de la última renovación
   *    exitosa: pasados los 14 días sin éxito, `endedReason` pasa a `DEVICE_EXPIRED`.
   *  - Error definitivo: `refresh` termina la sesión (conserva el secreto para el sync-token).
   */
  async validateIfDue(tenantId: string): Promise<void> {
    try {
      const state = this.state
      const entry = state.get(tenantId)
      if (!entry || !entry.sessionActive || state.endedReason(tenantId)) return
      const now = this.deps.now()
      if (entry.lastCheckedAt && now - entry.lastCheckedAt < VALIDATION_INTERVAL_MS) return
      const r = await this.refresh(tenantId)
      if (!r.ok && r.code === 'UNAVAILABLE') state.markChecked(tenantId, this.deps.now())
    } catch {
      /* la validación nunca debe romper la operación que la disparó */
    }
  }

  /** Token de solo subida (`scope=sync`) para una caja revocada/vencida/sin sesión. No rota el secreto. */
  async syncToken(tenantId: string): Promise<SessionSyncToken | SessionFailure> {
    const entry = this.state.get(tenantId)
    if (!entry) return fail('NO_DEVICE', 'Esta caja no tiene sesión de dispositivo')
    const r = await this.deps.client.syncToken(entry.secret)
    if (r.ok) return { ok: true, accessToken: r.accessToken, expiresIn: r.expiresIn }
    const failure = toFailure(r)
    if (failure.code === 'DEVICE_SECRET_INVALID') this.state.remove(tenantId)
    return failure
  }

  /** Logout del cajero: la caja sigue registrada (puede subir lo pendiente) pero renovar exige login. Best-effort en el backend. */
  async logout(tenantId: string): Promise<void> {
    const entry = this.state.get(tenantId)
    if (!entry) return
    this.state.markLoggedOut(tenantId)
    await this.deps.client.logout(entry.secret)
  }
}

const globalRef = globalThis as typeof globalThis & { __omeroDeviceSession?: DeviceSession }

export function getDeviceSession(): DeviceSession {
  return (globalRef.__omeroDeviceSession ??= new DeviceSession())
}

export function resetDeviceSession(): void {
  delete globalRef.__omeroDeviceSession
}
