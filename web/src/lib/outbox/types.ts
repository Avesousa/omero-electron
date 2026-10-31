/**
 * Outbox de ventas y gastos del POS desktop (fase 3). Ver AiBuild/feature/pos-offline-outbox/.
 * Toda venta/gasto se guarda primero acá (SQLite, durable) y un sender los sube al backend en segundo plano.
 */

export type OutboxType = 'SALE' | 'EXPENSE'

/**
 * PENDING  = por enviar o reintentando
 * SENT     = el backend lo creó (o ya lo tenía: DUPLICATE)
 * REVIEW   = el backend lo creó pero lo marcó para revisión (p. ej. producto eliminado)
 * FAILED   = el backend lo rechazó (dato conservado, sin reintento)
 */
export type OutboxStatus = 'PENDING' | 'SENT' | 'REVIEW' | 'FAILED'

export interface OutboxRow {
  seq: number
  clientId: string
  type: OutboxType
  /** JSON del request original del POS (sin costo). */
  payload: string
  /** ISO-8601 UTC, hora de la caja. */
  createdAt: string
  /** Cajero que lo creó (claim userId del JWT); informativo. */
  sourceUserId: string | null
  status: OutboxStatus
  attempts: number
  lastAttemptAt: string | null
  sentAt: string | null
  serverId: string | null
  reviewJson: string | null
  error: string | null
  dismissedAt: string | null
}

export interface OutboxCounts {
  pending: number
  sent: number
  review: number
  failed: number
}

export interface EnqueueInput {
  type: OutboxType
  payload: string
  /** ISO-8601; por defecto ahora. Para la importación de la cola vieja, la fecha original. */
  createdAt?: string
  sourceUserId?: string | null
  /** Solo la importación de la cola vieja lo fija (id derivado estable); en el resto se genera un UUID v4. */
  clientId?: string
}

export interface ListOptions {
  statuses?: OutboxStatus[]
  limit?: number
  offset?: number
  /** Incluye los FAILED ya descartados por el usuario (por defecto no). */
  includeDismissed?: boolean
}

export interface SendResultSent {
  serverId: string
  sentAt: string
}
