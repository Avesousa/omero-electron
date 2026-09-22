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
  private readonly deps: { state: () => DeviceState; client: DeviceClient }
  private sink: TokenSink | null

  constructor(deps: DeviceSessionDeps = {}) {
    this.deps = { state: () => deps.state ?? getDeviceState(), client: deps.client ?? new DeviceClient() }
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

    const r = await this.deps.client.refresh(entry.secret)
    if (r.ok) {
      state.set(tenantId, r.deviceSecret, true) // el secreto rotó: se persiste antes de seguir
      this.sink?.remember(tenantId, `Bearer ${r.accessToken}`)
      return { ok: true, accessToken: r.accessToken, expiresIn: r.expiresIn, user: r.user }
    }
    const failure = toFailure(r)
    // El backend ya no acepta renovar con esta sesión: no insistir en cada request.
    if (failure.code === 'LOGIN_REQUIRED') state.markLoggedOut(tenantId)
    if (failure.code === 'DEVICE_SECRET_INVALID') state.remove(tenantId)
    return failure
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
