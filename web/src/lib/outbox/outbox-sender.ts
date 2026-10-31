import { getBackendUrl } from '../runtime'
import { getSyncer, type SyncerEvent } from '../catalog/syncer'
import { tenantFromAuthHeader, tokenExpiry } from '../catalog/tenant'
import { getTokenProvider, type Authorized } from '../device/token-provider'
import { getOutboxStore } from './outbox-registry'
import type { OutboxRow } from './types'
import type { OutboxStore } from './outbox-store'

/**
 * Sube el outbox al backend en segundo plano (solo desktop). Un sender por proceso, una cola por tenant:
 *  - Lotes de hasta `BATCH_SIZE` ítems PENDING, del más viejo al más nuevo → `POST /api/sync/batch`.
 *  - El resultado por ítem decide su estado (SENT / REVIEW / FAILED); un ítem malo no frena a los demás.
 *  - Fallos de transporte (red, timeout, 5xx, 404, respuesta inválida) → reintento a 30 s → 90 s → 270 s → 810 s y luego
 *    cada 810 s (los fallos consecutivos del tenant; un lote exitoso reinicia la cuenta).
 *  - 401/403 → se detiene y olvida el token (el POS debe iniciar sesión; lo pendiente NO se pierde).
 *  - El `Authorization` sale del `CatalogSyncer` (solo en memoria); jamás se guarda en disco.
 */

export const BATCH_SIZE = 50
export const BACKOFF_STEPS_MS = [30_000, 90_000, 270_000, 810_000] as const
export const SEND_TIMEOUT_MS = 30_000
const PURGE_EVERY_MS = 60 * 60 * 1000

export type BackendState = 'ok' | 'offline' | 'unsupported' | 'unauthorized'

export interface SenderState {
  backend: BackendState
  /** ISO del próximo reintento programado, o null. */
  nextAttemptAt: string | null
  /** Fallos consecutivos de transporte. */
  failures: number
}

export interface SenderDeps {
  fetchFn?: typeof fetch
  getStore?: (tenantId: string) => OutboxStore | null
  /** Test/compat: token síncrono del syncer. En producción se usa `authorize` (renueva con la sesión de la caja). */
  getAuthorization?: (tenantId: string) => string | null
  /** Devuelve un Authorization válido (renovando si hace falta) o por qué no. */
  authorize?: (tenantId: string) => Promise<Authorized>
  /** El backend rechazó el token: olvidar lo cacheado. */
  invalidateAuthorization?: (tenantId: string) => void
  forgetAuthorization?: (tenantId: string) => void
  backendUrl?: () => string
  now?: () => number
  log?: (message: string) => void
}

interface TenantQueue {
  running: boolean
  /** Alguien pidió enviar mientras corría un lote: hay que revisar de nuevo al terminar. */
  again: boolean
  timer: ReturnType<typeof setTimeout> | null
  failures: number
  backend: BackendState
  nextAttemptAt: number | null
  batchSize: number
  lastPurge: number
  /** Se pidió un envío FORZADO (conexión recuperada / token nuevo) mientras corría uno: si ese falla, se reintenta ya. */
  forceAgain: boolean
  /** Ya se reintentó UNA vez tras un 401/403 renovando la sesión (se limpia con el primer éxito). */
  authRetried: boolean
}

/** Espera antes del reintento número `failures` (1 = primer fallo). */
export function backoffDelayMs(failures: number): number {
  const i = Math.min(Math.max(failures, 1), BACKOFF_STEPS_MS.length) - 1
  return BACKOFF_STEPS_MS[i]
}

interface ItemResult {
  clientId: string
  status: 'CREATED' | 'DUPLICATE' | 'REJECTED'
  entityId?: string | null
  review?: unknown
  error?: { code?: string; message?: string } | null
}

type SendOutcome = 'progress' | 'idle' | 'failed' | 'stopped'

export class OutboxSender {
  private readonly queues = new Map<string, TenantQueue>()
  private readonly deps: Required<SenderDeps>

  constructor(deps: SenderDeps = {}) {
    this.deps = {
      fetchFn: deps.fetchFn ?? fetch,
      getStore: deps.getStore ?? ((tenantId) => getOutboxStore(tenantId)),
      getAuthorization: deps.getAuthorization ?? ((tenantId) => getSyncer().getAuthorization(tenantId)),
      authorize:
        deps.authorize ??
        (deps.getAuthorization
          ? async (tenantId) => {
              const a = deps.getAuthorization!(tenantId)
              return a ? { ok: true, authorization: a, kind: 'pos' } : { ok: false, reason: 'unauthorized' }
            }
          : (tenantId) => getTokenProvider().authorize(tenantId)),
      invalidateAuthorization: deps.invalidateAuthorization ?? ((tenantId) => getTokenProvider().invalidate(tenantId)),
      forgetAuthorization: deps.forgetAuthorization ?? ((tenantId) => getSyncer().forget(tenantId)),
      backendUrl: deps.backendUrl ?? getBackendUrl,
      now: deps.now ?? Date.now,
      log: deps.log ?? ((m) => console.warn(`[outbox-sender] ${m}`)),
    }
  }

  private queue(tenantId: string): TenantQueue {
    let q = this.queues.get(tenantId)
    if (!q) {
      q = {
        running: false,
        again: false,
        timer: null,
        failures: 0,
        backend: 'ok',
        nextAttemptAt: null,
        batchSize: BATCH_SIZE,
        lastPurge: 0,
        authRetried: false,
        forceAgain: false,
      }
      this.queues.set(tenantId, q)
    }
    return q
  }

  state(tenantId: string): SenderState {
    const q = this.queues.get(tenantId)
    return {
      backend: q?.backend ?? 'ok',
      nextAttemptAt: q?.nextAttemptAt ? new Date(q.nextAttemptAt).toISOString() : null,
      failures: q?.failures ?? 0,
    }
  }

  /**
   * Pide enviar lo pendiente del tenant. Sin `force` respeta un reintento ya programado (una venta nueva no salta
   * el backoff); con `force` (conexión recuperada / nuevo login) lo cancela y reinicia la cuenta de fallos.
   */
  kick(tenantId: string, options: { force?: boolean } = {}): void {
    const q = this.queue(tenantId)
    if (options.force) {
      this.clearTimer(q)
      q.failures = 0
      if (q.backend === 'offline' || q.backend === 'unsupported') q.backend = 'ok'
    }
    if (q.timer) return // hay un reintento programado
    if (q.backend === 'unauthorized' && !options.force) return
    if (q.running) {
      q.again = true
      if (options.force) q.forceAgain = true // el envío en curso puede fallar justo antes de que volviera la conexión
      return
    }
    void this.run(tenantId)
  }

  /** Eventos del syncer: conexión recuperada → todos los tenants; token nuevo → ese tenant. */
  handleSyncerEvent(event: SyncerEvent): void {
    if (event.type === 'online') {
      for (const tenantId of this.queues.keys()) this.kick(tenantId, { force: true })
    } else {
      const q = this.queue(event.tenantId) // tras un reinicio el tenant aún no tiene cola: se crea al ver su token
      if (q.backend === 'unauthorized') {
        q.backend = 'ok'
        this.kick(event.tenantId, { force: true })
      } else {
        this.kick(event.tenantId)
      }
    }
  }

  /** Cancela los timers (tests / cierre). */
  stop(): void {
    for (const q of this.queues.values()) this.clearTimer(q)
  }

  private clearTimer(q: TenantQueue): void {
    if (q.timer) clearTimeout(q.timer)
    q.timer = null
    q.nextAttemptAt = null
  }

  private async run(tenantId: string): Promise<void> {
    const q = this.queue(tenantId)
    if (q.running) return
    q.running = true
    q.timer = null
    q.nextAttemptAt = null
    try {
      let outcome: SendOutcome
      do {
        do {
          q.again = false
          outcome = await this.sendOne(tenantId, q)
        } while (outcome === 'progress' || (outcome === 'idle' && q.again))
        if (outcome === 'failed' && q.forceAgain) {
          // Llegó un "volvió la conexión" mientras este envío fallaba: reintentar ya, sin esperar el backoff.
          q.forceAgain = false
          q.failures = 0
          if (q.backend === 'offline' || q.backend === 'unsupported') q.backend = 'ok'
          outcome = 'progress'
        }
      } while (outcome === 'progress')
      if (outcome === 'failed') this.scheduleRetry(tenantId, q)
    } catch (err) {
      this.deps.log(`error inesperado: ${(err as Error).message}`)
      q.failures += 1
      this.scheduleRetry(tenantId, q)
    } finally {
      q.running = false
    }
  }

  private scheduleRetry(tenantId: string, q: TenantQueue): void {
    const delay = backoffDelayMs(q.failures)
    q.nextAttemptAt = this.deps.now() + delay
    q.timer = setTimeout(() => void this.run(tenantId), delay)
    q.timer.unref?.()
  }

  /** Envía un lote. `progress` = quedan pendientes y conviene seguir; `idle` = nada que hacer. */
  private async sendOne(tenantId: string, q: TenantQueue): Promise<SendOutcome> {
    const store = this.deps.getStore(tenantId)
    if (!store) return 'idle'

    const batch = store.nextBatch(q.batchSize)
    if (batch.length === 0) {
      this.maintenance(store, q)
      return 'idle'
    }

    const auth = await this.deps.authorize(tenantId)
    if (!auth.ok && auth.reason === 'unavailable') return this.transportFailure(q, 'offline') // sin red para renovar: backoff
    const authorization = auth.ok ? auth.authorization : null
    if (!authorization || tenantFromAuthHeader(authorization) !== tenantId || this.expired(authorization)) {
      this.deps.forgetAuthorization(tenantId)
      q.backend = 'unauthorized'
      return 'stopped'
    }

    const { items, unreadable } = this.buildItems(batch)
    for (const row of unreadable) store.markFailed(row.clientId, 'Datos ilegibles en el outbox local')
    if (items.length === 0) return 'progress'

    store.markAttempt(items.map((i) => i.clientId))

    let res: Response
    try {
      res = await this.deps.fetchFn(`${this.deps.backendUrl()}/api/sync/batch`, {
        method: 'POST',
        headers: { Authorization: authorization, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ items }),
        redirect: 'manual',
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      })
    } catch {
      return this.transportFailure(q, 'offline')
    }

    if (res.status === 401 || res.status === 403) {
      if (!q.authRetried) {
        // Puede ser un JWT vencido/rechazado: se renueva con la sesión de la caja y se reintenta UNA vez.
        q.authRetried = true
        this.deps.invalidateAuthorization(tenantId)
        return 'progress'
      }
      q.authRetried = false
      this.deps.forgetAuthorization(tenantId)
      q.backend = 'unauthorized'
      return 'stopped'
    }
    if (res.status === 404) return this.transportFailure(q, 'unsupported')
    if (res.status === 413 && q.batchSize > 1) {
      q.batchSize = Math.max(1, Math.floor(q.batchSize / 2)) // lote demasiado grande: partirlo, sin castigar
      return 'progress'
    }
    if (!res.ok) return this.transportFailure(q, 'offline')

    const results = await this.readResults(res)
    if (!results) return this.transportFailure(q, 'offline')

    return this.applyResults(store, q, items, results)
  }

  private applyResults(store: OutboxStore, q: TenantQueue, items: { clientId: string }[], results: ItemResult[]): SendOutcome {
    const sentAt = new Date(this.deps.now()).toISOString()
    const byId = new Map(results.map((r) => [r.clientId, r]))
    let processed = 0
    let internalErrors = 0

    for (const { clientId } of items) {
      const r = byId.get(clientId)
      if (!r) continue // el backend no lo informó: sigue PENDING
      if (r.status === 'CREATED' || r.status === 'DUPLICATE') {
        const done = { serverId: String(r.entityId ?? ''), sentAt }
        if (r.review) store.markReview(clientId, done, JSON.stringify(r.review))
        else store.markSent(clientId, done)
        processed++
      } else if (r.status === 'REJECTED') {
        if (r.error?.code === 'INTERNAL_ERROR') {
          internalErrors++ // fallo del servidor: se reintenta
        } else {
          store.markFailed(clientId, r.error?.message ?? 'Rechazado por el backend')
          processed++
        }
      }
    }

    // Se resolvió algo sin fallos del servidor → seguir de inmediato si quedan pendientes.
    if (processed > 0) q.authRetried = false
    if (internalErrors === 0 && processed > 0) {
      q.failures = 0
      q.backend = 'ok'
      q.batchSize = BATCH_SIZE
      return store.counts().pending > 0 ? 'progress' : 'idle'
    }
    // Sin avance útil (todo INTERNAL_ERROR o respuesta sin datos) o con errores del servidor: backoff.
    if (processed > 0) q.failures = 0
    return this.transportFailure(q, 'offline')
  }

  private transportFailure(q: TenantQueue, backend: 'offline' | 'unsupported'): SendOutcome {
    q.failures += 1
    q.backend = backend
    return 'failed'
  }

  private async readResults(res: Response): Promise<ItemResult[] | null> {
    try {
      const body = (await res.json()) as { success?: boolean; data?: { results?: ItemResult[] } }
      const results = body?.data?.results
      return body?.success && Array.isArray(results) ? results : null
    } catch {
      return null
    }
  }

  private buildItems(rows: OutboxRow[]) {
    const items: Record<string, unknown>[] = []
    const unreadable: OutboxRow[] = []
    for (const row of rows) {
      try {
        const payload = JSON.parse(row.payload) as Record<string, unknown>
        items.push({
          type: row.type,
          clientId: row.clientId,
          createdAt: row.createdAt,
          sourceUserId: row.sourceUserId,
          ...(row.type === 'SALE' ? { sale: payload } : { expense: payload }),
        })
      } catch {
        unreadable.push(row)
      }
    }
    return { items: items as ({ clientId: string } & Record<string, unknown>)[], unreadable }
  }

  private expired(authorization: string): boolean {
    const exp = tokenExpiry(authorization)
    return exp !== null && exp * 1000 <= this.deps.now()
  }

  private maintenance(store: OutboxStore, q: TenantQueue): void {
    const now = this.deps.now()
    if (now - q.lastPurge < PURGE_EVERY_MS) return
    q.lastPurge = now
    try {
      store.purge(new Date(now))
    } catch (err) {
      this.deps.log(`purga falló: ${(err as Error).message}`)
    }
  }
}

const globalRef = globalThis as typeof globalThis & { __omeroOutboxSender?: { sender: OutboxSender; unsubscribe: () => void } }

/** Singleton del proceso; se engancha a los eventos del syncer la primera vez. */
export function getSender(): OutboxSender {
  if (!globalRef.__omeroOutboxSender) {
    const sender = new OutboxSender()
    const unsubscribe = getSyncer().subscribe((event) => sender.handleSyncerEvent(event))
    globalRef.__omeroOutboxSender = { sender, unsubscribe }
  }
  return globalRef.__omeroOutboxSender.sender
}

/** Detiene el sender del proceso y lo desengancha del syncer (tests; un reinicio simulado). */
export function resetSender(): void {
  const current = globalRef.__omeroOutboxSender
  if (!current) return
  current.sender.stop()
  current.unsubscribe()
  delete globalRef.__omeroOutboxSender
}
