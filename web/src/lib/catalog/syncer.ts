import { getBackendUrl, getSyncIntervalMs } from '../runtime'
import { checkBackend } from './connectivity'
import { applyCatalogPayload } from './snapshot'
import { getCatalogStore } from './store-registry'
import { tokenExpiry } from './tenant'
import type { CatalogRoute, CatalogStore } from './types'

/**
 * Refresca en segundo plano la caché de catálogo de los tenants con sesión activa (solo desktop):
 * - Cada `CATALOG_SYNC_INTERVAL_MS` (5 min) descarga `products` y `promotions` directo del backend.
 * - Si falla, entra en MODO RECUPERACIÓN: sondea `/api/health` cada 30 s y, al responder, sincroniza de inmediato
 *   ("al recuperar conexión").
 * - El `Authorization` vive SOLO en memoria (nunca en disco ni en logs). Si vence o el backend responde 401/403 se
 *   olvida hasta la próxima request autenticada (limitación aceptada: JWT de 1 h; la resuelve la fase 4).
 */

export const RECOVERY_INTERVAL_MS = 30_000
const SYNC_TIMEOUT_MS = 15_000

interface TokenEntry {
  authorization: string
  /** `exp` del JWT en segundos epoch (null si no trae). */
  exp: number | null
}

export interface SyncerDeps {
  fetchFn?: typeof fetch
  getStore?: (tenantId: string) => CatalogStore | null
  backendUrl?: () => string
  intervalMs?: () => number
  recoveryMs?: number
  now?: () => number
  log?: (message: string) => void
}

type TenantResult = 'ok' | 'unauthorized' | 'failed'

/** Eventos que el syncer publica para otros componentes (el sender del outbox). */
export type SyncerEvent =
  | { type: 'online' } // el backend volvió a responder (transición de no-conectado a conectado)
  | { type: 'authorization'; tenantId: string } // hay un token nuevo (o distinto) para el tenant

export class CatalogSyncer {
  private readonly tokens = new Map<string, TokenEntry>()
  private timer: ReturnType<typeof setInterval> | null = null
  private recoveryTimer: ReturnType<typeof setInterval> | null = null
  private running = false
  private lastOnline: boolean | null = null
  private readonly listeners = new Set<(event: SyncerEvent) => void>()
  private readonly deps: Required<SyncerDeps>

  constructor(deps: SyncerDeps = {}) {
    this.deps = {
      fetchFn: deps.fetchFn ?? fetch,
      getStore: deps.getStore ?? ((tenantId) => getCatalogStore(tenantId)),
      backendUrl: deps.backendUrl ?? getBackendUrl,
      intervalMs: deps.intervalMs ?? getSyncIntervalMs,
      recoveryMs: deps.recoveryMs ?? RECOVERY_INTERVAL_MS,
      now: deps.now ?? Date.now,
      log: deps.log ?? ((m) => console.warn(`[catalog-sync] ${m}`)),
    }
  }

  /** Último estado conocido de la conexión con el backend (null si aún no se sabe). */
  get online(): boolean | null {
    return this.lastOnline
  }

  /** Registra pasivamente el estado (lo informa el endpoint de conectividad; no dispara sincronización). */
  setOnline(value: boolean): void {
    const recovered = value && this.lastOnline !== true
    this.lastOnline = value
    if (recovered) this.emit({ type: 'online' })
  }

  /** Suscribe a los eventos del syncer. Devuelve la función para desuscribirse. */
  subscribe(listener: (event: SyncerEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(event: SyncerEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event)
      } catch (err) {
        this.deps.log(`listener falló: ${(err as Error).message}`)
      }
    }
  }

  /** Último Authorization vigente del tenant (solo en memoria), o null si no hay o venció. */
  getAuthorization(tenantId: string): string | null {
    const entry = this.tokens.get(tenantId)
    if (!entry) return null
    if (entry.exp !== null && entry.exp * 1000 <= this.deps.now()) return null
    return entry.authorization
  }

  get inRecovery(): boolean {
    return this.recoveryTimer !== null
  }

  hasTenant(tenantId: string): boolean {
    return this.tokens.has(tenantId)
  }

  /** Guarda el último Authorization del tenant y arranca el timer si hace falta. */
  remember(tenantId: string, authorization: string): void {
    const changed = this.tokens.get(tenantId)?.authorization !== authorization
    this.tokens.set(tenantId, { authorization, exp: tokenExpiry(authorization) })
    this.start()
    if (changed) this.emit({ type: 'authorization', tenantId })
  }

  forget(tenantId: string): void {
    this.tokens.delete(tenantId)
    if (this.tokens.size === 0) this.stop()
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.syncAll(), this.deps.intervalMs())
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.stopRecovery()
  }

  private stopRecovery(): void {
    if (this.recoveryTimer) clearInterval(this.recoveryTimer)
    this.recoveryTimer = null
  }

  private startRecovery(): void {
    if (this.recoveryTimer) return
    this.recoveryTimer = setInterval(() => void this.probeAndSync(), this.deps.recoveryMs)
    this.recoveryTimer.unref?.()
  }

  private async probeAndSync(): Promise<void> {
    const status = await checkBackend({
      fetchFn: this.deps.fetchFn,
      backendUrl: this.deps.backendUrl(),
    })
    const recovered = status.online && this.lastOnline !== true
    this.lastOnline = status.online
    if (recovered) this.emit({ type: 'online' })
    if (status.online) await this.syncAll()
  }

  /** Sincroniza todos los tenants con token vigente. Nunca lanza. */
  async syncAll(): Promise<void> {
    if (this.running) return
    this.running = true
    let anyFailed = false
    try {
      for (const [tenantId, entry] of [...this.tokens]) {
        if (entry.exp !== null && entry.exp * 1000 <= this.deps.now()) {
          this.forget(tenantId) // vencido: se espera una nueva request autenticada
          continue
        }
        const result = await this.syncTenant(tenantId, entry.authorization)
        if (result === 'unauthorized') this.forget(tenantId)
        else if (result === 'failed') anyFailed = true
      }
    } catch (err) {
      anyFailed = true
      this.deps.log(`error inesperado: ${(err as Error).message}`)
    } finally {
      this.running = false
    }

    if (anyFailed) {
      this.lastOnline = false
      this.startRecovery()
    } else if (this.tokens.size > 0) {
      const recovered = this.lastOnline !== true
      this.lastOnline = true
      this.stopRecovery()
      if (recovered) this.emit({ type: 'online' })
    }
  }

  private async syncTenant(tenantId: string, authorization: string): Promise<TenantResult> {
    const store = this.deps.getStore(tenantId)
    if (!store) return 'ok' // sin caché no hay nada que refrescar

    const routes: { path: string; route: CatalogRoute; optional?: boolean }[] = [
      { path: '/api/products', route: { kind: 'products' } },
      { path: '/api/promotions', route: { kind: 'promotions' } },
      // Configuración que el POS necesita sin conexión. No crítica: un 404 (backend viejo) o un error no dispara la
      // recuperación; si la red cayó ya lo detectan products/promotions.
      { path: '/api/business/config/mp_offline', route: { kind: 'setting', key: 'mp_offline' }, optional: true },
    ]

    let failed = false
    for (const { path, route, optional } of routes) {
      try {
        const res = await this.deps.fetchFn(`${this.deps.backendUrl()}${path}`, {
          headers: { Authorization: authorization, Accept: 'application/json' },
          redirect: 'manual',
          signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
        })
        if (res.status === 401 || res.status === 403) return 'unauthorized'
        if (!res.ok) {
          if (!optional) failed = true
          continue
        }
        if (!applyCatalogPayload(store, route, await res.text()) && !optional) failed = true
      } catch {
        if (!optional) failed = true // red caída / timeout
      }
    }
    return failed ? 'failed' : 'ok'
  }
}

const globalRef = globalThis as typeof globalThis & { __omeroCatalogSyncer?: CatalogSyncer }

/** Singleton del proceso (sobrevive a recargas de módulos en dev). */
export function getSyncer(): CatalogSyncer {
  return (globalRef.__omeroCatalogSyncer ??= new CatalogSyncer())
}
