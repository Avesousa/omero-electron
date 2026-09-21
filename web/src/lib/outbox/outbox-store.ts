import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { LATEST_OUTBOX_SCHEMA_VERSION, OUTBOX_MIGRATIONS } from './outbox-migrations'
import type {
  EnqueueInput,
  ListOptions,
  OutboxCounts,
  OutboxRow,
  OutboxStatus,
  SendResultSent,
} from './types'

/**
 * Outbox durable de ventas y gastos (una base SQLite por tenant: `<dataDir>/<tenantId>.outbox.sqlite`).
 *
 * A diferencia de la caché del catálogo (prescindible):
 * - `synchronous = FULL`: una venta confirmada al cajero NO se pierde ante un corte de luz.
 * - NUNCA se borra una base dañada o de esquema más nuevo: contiene ventas sin subir. Se APARTA
 *   (`.corrupt-<timestamp>`) y se crea una nueva, para poder recuperarla a mano.
 * - No se borra al cerrar sesión (las ventas pendientes pertenecen al tenant).
 */

type DatabaseConstructor = typeof import('better-sqlite3')
type Db = InstanceType<DatabaseConstructor>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** SENT se conserva 7 días (ajuste de stock local y auditoría); REVIEW y los FAILED descartados, 30 días (se ven en la lista del POS). */
export const SENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
export const DISMISSED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
/** Margen al comparar `sent_at` contra la fecha del snapshot de la caché (reloj y latencia). */
export const SNAPSHOT_MARGIN_MS = 2000

export interface OutboxOpenOptions {
  dataDir: string
  tenantId: string
  Database: DatabaseConstructor
  nativeBinding?: string | null
  log?: (message: string) => void
}

/** Ruta del outbox de un tenant; lanza si el tenantId no es UUID o la ruta escapa de `dataDir`. */
export function resolveOutboxPath(dataDir: string, tenantId: string): string {
  if (!UUID.test(tenantId)) throw new Error('tenantId inválido para el outbox')
  const root = path.resolve(dataDir)
  const file = path.resolve(root, `${tenantId.toLowerCase()}.outbox.sqlite`)
  if (!file.startsWith(root + path.sep)) throw new Error('Ruta de outbox fuera del directorio de datos')
  return file
}

function errorCode(err: unknown): string | undefined {
  return (err as { code?: string } | null)?.code
}

function isCorruption(err: unknown): boolean {
  const code = errorCode(err)
  return code === 'SQLITE_CORRUPT' || code === 'SQLITE_NOTADB' || code === 'SQLITE_CANTOPEN_CORRUPT'
}

interface RawRow {
  seq: number
  client_id: string
  type: 'SALE' | 'EXPENSE'
  payload: string
  created_at: string
  source_user_id: string | null
  status: OutboxStatus
  attempts: number
  last_attempt_at: string | null
  sent_at: string | null
  server_id: string | null
  review_json: string | null
  error: string | null
  dismissed_at: string | null
}

const toRow = (r: RawRow): OutboxRow => ({
  seq: r.seq,
  clientId: r.client_id,
  type: r.type,
  payload: r.payload,
  createdAt: r.created_at,
  sourceUserId: r.source_user_id,
  status: r.status,
  attempts: r.attempts,
  lastAttemptAt: r.last_attempt_at,
  sentAt: r.sent_at,
  serverId: r.server_id,
  reviewJson: r.review_json,
  error: r.error,
  dismissedAt: r.dismissed_at,
})

/** Aparta la base (y su -wal/-shm) sin borrarla. */
function quarantine(file: string): string {
  const suffix = `.corrupt-${Date.now()}`
  for (const ext of ['', '-wal', '-shm']) {
    if (fs.existsSync(file + ext)) fs.renameSync(file + ext, file + suffix + ext)
  }
  return file + suffix
}

export class OutboxStore {
  readonly tenantId: string
  readonly file: string
  private db: Db | null

  private constructor(tenantId: string, file: string, db: Db) {
    this.tenantId = tenantId
    this.file = file
    this.db = db
  }

  /** Abre (o crea) el outbox del tenant y aplica migraciones. Lanza en errores de I/O/permisos. */
  static open(options: OutboxOpenOptions): OutboxStore {
    const { dataDir, Database, nativeBinding } = options
    const tenantId = options.tenantId.toLowerCase()
    const log = options.log ?? ((m: string) => console.warn(`[outbox] ${m}`))
    const file = resolveOutboxPath(dataDir, tenantId)
    fs.mkdirSync(path.dirname(file), { recursive: true })

    const attempt = (): Db => {
      const db = new Database(file, nativeBinding ? { nativeBinding } : undefined)
      try {
        db.pragma('journal_mode = WAL')
        db.pragma('synchronous = FULL')
        db.pragma('busy_timeout = 3000')

        const current = db.pragma('user_version', { simple: true }) as number
        if (current > LATEST_OUTBOX_SCHEMA_VERSION) {
          const error = new Error(`Esquema ${current} más nuevo que el soportado (${LATEST_OUTBOX_SCHEMA_VERSION})`)
          Object.assign(error, { code: 'OMERO_SCHEMA_TOO_NEW' })
          throw error
        }
        const pending = OUTBOX_MIGRATIONS.filter((m) => m.version > current)
        if (pending.length > 0) {
          db.transaction(() => {
            for (const m of pending) {
              db.exec(m.sql)
              db.pragma(`user_version = ${m.version}`)
            }
          })()
        }
        return db
      } catch (err) {
        try {
          db.close()
        } catch {
          /* ya cerrada */
        }
        throw err
      }
    }

    let db: Db
    try {
      db = attempt()
    } catch (err) {
      if (!isCorruption(err) && errorCode(err) !== 'OMERO_SCHEMA_TOO_NEW') throw err
      const moved = quarantine(file)
      log(`outbox de ${tenantId} dañado o de esquema más nuevo (${errorCode(err)}): se apartó en ${path.basename(moved)} y se crea uno nuevo`)
      db = attempt()
    }
    return new OutboxStore(tenantId, file, db)
  }

  private get conn(): Db {
    if (!this.db) throw new Error('El outbox está cerrado')
    return this.db
  }

  /**
   * Inserta una venta/gasto. Se confirma en disco (synchronous=FULL) antes de retornar: recién ahí el POS
   * recibe su 201. Si el `clientId` ya existe (importación de la cola vieja) devuelve la fila existente.
   */
  enqueue(input: EnqueueInput): { row: OutboxRow; inserted: boolean } {
    const clientId = input.clientId ?? randomUUID()
    const info = this.conn
      .prepare(
        `INSERT INTO outbox (client_id, type, payload, created_at, source_user_id)
         VALUES (?, ?, ?, ?, ?) ON CONFLICT(client_id) DO NOTHING`,
      )
      .run(clientId, input.type, input.payload, input.createdAt ?? new Date().toISOString(), input.sourceUserId ?? null)
    const row = this.getByClientId(clientId)
    if (!row) throw new Error('No se pudo leer la fila recién insertada del outbox')
    return { row, inserted: info.changes > 0 }
  }

  getByClientId(clientId: string): OutboxRow | null {
    const r = this.conn.prepare('SELECT * FROM outbox WHERE client_id = ?').get(clientId) as RawRow | undefined
    return r ? toRow(r) : null
  }

  /** Próximos ítems por enviar, del más viejo al más nuevo. */
  nextBatch(limit: number): OutboxRow[] {
    return (
      this.conn.prepare(`SELECT * FROM outbox WHERE status = 'PENDING' ORDER BY seq ASC LIMIT ?`).all(limit) as RawRow[]
    ).map(toRow)
  }

  /** Cuenta un intento de envío (fallo o no) para los ítems del lote. */
  markAttempt(clientIds: string[], now: Date = new Date()): void {
    const stmt = this.conn.prepare(`UPDATE outbox SET attempts = attempts + 1, last_attempt_at = ? WHERE client_id = ?`)
    this.conn.transaction(() => {
      for (const id of clientIds) stmt.run(now.toISOString(), id)
    })()
  }

  /** El backend lo creó (o ya lo tenía). Solo transiciona desde PENDING (idempotente). */
  markSent(clientId: string, result: SendResultSent): boolean {
    return (
      this.conn
        .prepare(
          `UPDATE outbox SET status = 'SENT', server_id = ?, sent_at = ?, error = NULL WHERE client_id = ? AND status = 'PENDING'`,
        )
        .run(result.serverId, result.sentAt, clientId).changes > 0
    )
  }

  /** El backend lo creó pero lo marcó para revisión. */
  markReview(clientId: string, result: SendResultSent, reviewJson: string): boolean {
    return (
      this.conn
        .prepare(
          `UPDATE outbox SET status = 'REVIEW', server_id = ?, sent_at = ?, review_json = ?, error = NULL
           WHERE client_id = ? AND status = 'PENDING'`,
        )
        .run(result.serverId, result.sentAt, reviewJson, clientId).changes > 0
    )
  }

  /** El backend lo rechazó de forma definitiva: el dato se conserva, no se reintenta. */
  markFailed(clientId: string, error: string): boolean {
    return (
      this.conn.prepare(`UPDATE outbox SET status = 'FAILED', error = ? WHERE client_id = ? AND status = 'PENDING'`).run(error, clientId)
        .changes > 0
    )
  }

  /** El usuario ya vio un FAILED: deja de contarse (queda auditable 30 días). */
  dismiss(clientId: string, now: Date = new Date()): boolean {
    return (
      this.conn
        .prepare(`UPDATE outbox SET dismissed_at = ? WHERE client_id = ? AND status = 'FAILED' AND dismissed_at IS NULL`)
        .run(now.toISOString(), clientId).changes > 0
    )
  }

  counts(): OutboxCounts {
    const rows = this.conn
      .prepare(
        `SELECT status, COUNT(*) AS n FROM outbox
         WHERE NOT (status = 'FAILED' AND dismissed_at IS NOT NULL) GROUP BY status`,
      )
      .all() as { status: OutboxStatus; n: number }[]
    const out: OutboxCounts = { pending: 0, sent: 0, review: 0, failed: 0 }
    for (const r of rows) out[r.status.toLowerCase() as keyof OutboxCounts] = r.n
    return out
  }

  list(options: ListOptions = {}): OutboxRow[] {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200)
    const offset = Math.max(options.offset ?? 0, 0)
    const where: string[] = []
    const params: unknown[] = []
    if (options.statuses?.length) {
      where.push(`status IN (${options.statuses.map(() => '?').join(',')})`)
      params.push(...options.statuses)
    }
    if (!options.includeDismissed) where.push(`NOT (status = 'FAILED' AND dismissed_at IS NOT NULL)`)
    const sql = `SELECT * FROM outbox ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY seq DESC LIMIT ? OFFSET ?`
    return (this.conn.prepare(sql).all(...params, limit, offset) as RawRow[]).map(toRow)
  }

  /**
   * Cantidad vendida por código de producto que el stock mostrado todavía NO refleja:
   * - siempre los PENDING (el backend aún no los conoce);
   * - si se le pasa `since` (fecha del snapshot de la caché de la que sale el stock), también los SENT/REVIEW
   *   enviados DESPUÉS de ese snapshot (el backend ya los descontó, pero el snapshot es anterior).
   * Con una respuesta "en vivo" del backend (`since` indefinido) solo cuentan los PENDING.
   * El código `000` (precio libre) no maneja stock y se ignora.
   */
  activeSaleQuantities(options: { since?: string | null } = {}): Map<string, number> {
    const rows = this.conn
      .prepare(
        `SELECT payload, status, sent_at FROM outbox
         WHERE type = 'SALE' AND (status = 'PENDING' OR (status IN ('SENT','REVIEW') AND sent_at IS NOT NULL))`,
      )
      .all() as { payload: string; status: OutboxStatus; sent_at: string | null }[]

    const sinceMs = options.since ? Date.parse(options.since) : null
    const totals = new Map<string, number>()
    for (const r of rows) {
      if (r.status !== 'PENDING') {
        if (options.since === undefined) continue // respuesta en vivo: el backend ya los incluye
        if (sinceMs !== null && !Number.isNaN(sinceMs) && Date.parse(r.sent_at!) <= sinceMs - SNAPSHOT_MARGIN_MS) continue
      }
      let items: unknown
      try {
        items = (JSON.parse(r.payload) as { items?: unknown }).items
      } catch {
        continue
      }
      if (!Array.isArray(items)) continue
      for (const item of items as { productId?: unknown; quantity?: unknown }[]) {
        const code = String(item?.productId ?? '')
        const qty = Number(item?.quantity)
        if (!code || code.startsWith('000') || !Number.isFinite(qty) || qty <= 0) continue
        totals.set(code, (totals.get(code) ?? 0) + qty)
      }
    }
    return totals
  }

  /** Elimina lo que ya cumplió su retención. Devuelve cuántas filas borró. */
  purge(now: Date = new Date()): number {
    const sentBefore = new Date(now.getTime() - SENT_RETENTION_MS).toISOString()
    const dismissedBefore = new Date(now.getTime() - DISMISSED_RETENTION_MS).toISOString()
    return this.conn
      .prepare(
        `DELETE FROM outbox WHERE
           (status = 'SENT'   AND sent_at < ?) OR
           (status = 'REVIEW' AND sent_at < ?) OR
           (status = 'FAILED' AND dismissed_at IS NOT NULL AND dismissed_at < ?)`,
      )
      .run(sentBefore, dismissedBefore, dismissedBefore).changes
  }

  getMeta(key: string): string | null {
    const r = this.conn.prepare('SELECT value FROM outbox_meta WHERE key = ?').get(key) as { value: string } | undefined
    return r ? r.value : null
  }

  setMeta(key: string, value: string): void {
    this.conn
      .prepare('INSERT INTO outbox_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value)
  }

  close(): void {
    if (!this.db) return
    try {
      this.db.close()
    } finally {
      this.db = null
    }
  }
}
