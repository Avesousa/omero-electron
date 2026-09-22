import { tokenExpiry } from '../catalog/tenant'
import { getSyncer } from '../catalog/syncer'
import { getDeviceSession, type DeviceSession } from './device-session'
import { wireDevice } from './device-wiring'

/**
 * Entrega al sender del outbox un `Authorization` válido para un tenant SIN que el cajero tenga que hacer nada:
 *
 *   1. JWT `pos` vigente (>2 min) que ya tiene el syncer → se usa.
 *   2. Sesión de la caja: `refresh` (rota el secreto) → JWT `pos` nuevo.
 *   3. Caja revocada / vencida / sin sesión (LOGIN_REQUIRED, DEVICE_EXPIRED, DEVICE_REVOKED): `sync-token` (JWT `scope=sync`,
 *      solo `/api/sync/batch`) dentro de la ventana de 30 días, para vaciar el outbox.
 *   4. Sin credencial de caja o ventana cerrada → `unauthorized` (el POS pide login, como antes; el outbox no se toca).
 * Falla de red/5xx → `unavailable` (el sender reintenta con su backoff; NO es un problema de credenciales).
 */

/** Se renueva un poco antes de que venza para no mandar un lote con un token que muere en el camino. */
export const RENEW_MARGIN_MS = 2 * 60_000

export type AuthKind = 'pos' | 'sync'

export type Authorized = { ok: true; authorization: string; kind: AuthKind } | { ok: false; reason: 'unauthorized' | 'unavailable' }

export interface TokenProviderDeps {
  syncer?: { getAuthorization(tenantId: string): string | null; forget?(tenantId: string): void }
  session?: DeviceSession
  now?: () => number
  wire?: () => void
}

interface CachedSync {
  token: string
  expiresAtMs: number
}

export class TokenProvider {
  private readonly syncTokens = new Map<string, CachedSync>()
  private readonly deps: { syncer: NonNullable<TokenProviderDeps['syncer']>; session: () => DeviceSession; now: () => number; wire: () => void }

  constructor(deps: TokenProviderDeps = {}) {
    this.deps = {
      syncer: deps.syncer ?? getSyncer(),
      session: () => deps.session ?? getDeviceSession(),
      now: deps.now ?? Date.now,
      wire: deps.wire ?? wireDevice,
    }
  }

  async authorize(tenantId: string): Promise<Authorized> {
    const now = this.deps.now()

    const live = this.deps.syncer.getAuthorization(tenantId)
    if (live && !this.expiresSoon(live, now)) return { ok: true, authorization: live, kind: 'pos' }

    const cached = this.syncTokens.get(tenantId)
    const session = this.deps.session()
    if (!session.state.enabled) {
      // Sin caja (web, dev, backend viejo): un token del syncer que aún no venció sigue sirviendo hasta el final.
      return live ? { ok: true, authorization: live, kind: 'pos' } : { ok: false, reason: 'unauthorized' }
    }
    this.deps.wire()

    const refreshed = await session.refresh(tenantId)
    if (refreshed.ok) {
      this.syncTokens.delete(tenantId)
      return { ok: true, authorization: `Bearer ${refreshed.accessToken}`, kind: 'pos' }
    }
    if (refreshed.code === 'UNAVAILABLE') return live ? { ok: true, authorization: live, kind: 'pos' } : { ok: false, reason: 'unavailable' }
    if (refreshed.code === 'NO_DEVICE' || refreshed.code === 'DEVICE_SECRET_INVALID') return { ok: false, reason: 'unauthorized' }

    // LOGIN_REQUIRED | DEVICE_EXPIRED | DEVICE_REVOKED → solo subir lo pendiente
    if (cached && cached.expiresAtMs - now > RENEW_MARGIN_MS) return { ok: true, authorization: cached.token, kind: 'sync' }
    const sync = await session.syncToken(tenantId)
    if (sync.ok) {
      const token = `Bearer ${sync.accessToken}`
      this.syncTokens.set(tenantId, { token, expiresAtMs: now + sync.expiresIn * 1000 })
      return { ok: true, authorization: token, kind: 'sync' }
    }
    return { ok: false, reason: sync.code === 'UNAVAILABLE' ? 'unavailable' : 'unauthorized' }
  }

  /** El backend rechazó el token (401/403): olvidar lo cacheado para que el próximo `authorize` renueve. */
  invalidate(tenantId: string): void {
    this.syncTokens.delete(tenantId)
    this.deps.syncer.forget?.(tenantId)
  }

  private expiresSoon(authorization: string, now: number): boolean {
    const exp = tokenExpiry(authorization)
    return exp !== null && exp * 1000 - now <= RENEW_MARGIN_MS
  }
}

const globalRef = globalThis as typeof globalThis & { __omeroTokenProvider?: TokenProvider }

export function getTokenProvider(): TokenProvider {
  return (globalRef.__omeroTokenProvider ??= new TokenProvider())
}

export function resetTokenProvider(): void {
  delete globalRef.__omeroTokenProvider
}
