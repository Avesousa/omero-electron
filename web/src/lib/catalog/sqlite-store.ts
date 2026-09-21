import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { LATEST_SCHEMA_VERSION, MIGRATIONS } from './migrations'
import type {
  CatalogMeta,
  CatalogResource,
  CatalogStore,
  ProductLike,
  PromotionLike,
  SnapshotResult,
} from './types'

/**
 * Caché de catálogo sobre `better-sqlite3`: UNA base por tenant (`<dataDir>/<tenantId>.sqlite`).
 *
 * - Guarda el JSON crudo de cada ítem (se sirve el DTO exacto del backend; no se desincroniza si el backend
 *   agrega campos). Las columnas `code`/`barcode` existen solo para los lookups.
 * - Los snapshots son transaccionales: si algo falla a mitad, queda el snapshot anterior.
 * - Es una caché PRESCINDIBLE: base corrupta o de versión más nueva → se elimina y se recrea.
 */

/** Constructor/instancia de better-sqlite3 (solo tipos: el módulo nativo NO se importa acá). */
type DatabaseConstructor = typeof import('better-sqlite3')
type Db = InstanceType<DatabaseConstructor>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface OpenOptions {
  dataDir: string
  tenantId: string
  /** Constructor de better-sqlite3 (inyectado para que este módulo no lo importe: solo desktop lo carga). */
  Database: DatabaseConstructor
  /** Ruta al `.node` a usar (binario de Electron empaquetado). Sin definir: el binding por defecto. */
  nativeBinding?: string | null
  log?: (message: string) => void
}

/** Ruta del archivo de un tenant; lanza si el tenantId no es un UUID o la ruta escapa de `dataDir`. */
export function resolveDbPath(dataDir: string, tenantId: string): string {
  if (!UUID.test(tenantId)) throw new Error('tenantId inválido para la caché de catálogo')
  const root = path.resolve(dataDir)
  const file = path.resolve(root, `${tenantId.toLowerCase()}.sqlite`)
  if (!file.startsWith(root + path.sep)) throw new Error('Ruta de caché fuera del directorio de datos')
  return file
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function errorCode(err: unknown): string | undefined {
  return (err as { code?: string } | null)?.code
}

/** true si el error indica una base dañada o que no es SQLite. */
function isCorruption(err: unknown): boolean {
  const code = errorCode(err)
  return code === 'SQLITE_CORRUPT' || code === 'SQLITE_NOTADB' || code === 'SQLITE_CANTOPEN_CORRUPT'
}

function removeDbFiles(file: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(file + suffix, { force: true })
    } catch {
      /* ignorar: el siguiente open falla con un error real si no se pudo borrar */
    }
  }
}

export class SqliteCatalogStore implements CatalogStore {
  readonly tenantId: string
  private db: Db | null
  private readonly file: string

  private constructor(tenantId: string, file: string, db: Db) {
    this.tenantId = tenantId
    this.file = file
    this.db = db
  }

  /** Abre (o crea) la base del tenant y aplica migraciones. Lanza en errores de I/O/permisos. */
  static open(options: OpenOptions): SqliteCatalogStore {
    const { dataDir, Database, nativeBinding } = options
    const tenantId = options.tenantId.toLowerCase()
    const log = options.log ?? ((m: string) => console.warn(`[catalog] ${m}`))
    const file = resolveDbPath(dataDir, tenantId)
    fs.mkdirSync(path.dirname(file), { recursive: true })

    const attempt = (): Db => {
      const db = new Database(file, nativeBinding ? { nativeBinding } : undefined)
      try {
        db.pragma('journal_mode = WAL')
        db.pragma('synchronous = NORMAL') // es una caché prescindible; la fase 3 usará otra política para el outbox
        db.pragma('busy_timeout = 3000')

        const current = db.pragma('user_version', { simple: true }) as number
        if (current > LATEST_SCHEMA_VERSION) {
          const error = new Error(`Esquema ${current} más nuevo que el soportado (${LATEST_SCHEMA_VERSION})`)
          Object.assign(error, { code: 'OMERO_SCHEMA_TOO_NEW' })
          throw error
        }

        const pending = MIGRATIONS.filter((m) => m.version > current)
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
          /* ya cerrada o inválida */
        }
        throw err
      }
    }

    let db: Db
    try {
      db = attempt()
    } catch (err) {
      if (!isCorruption(err) && errorCode(err) !== 'OMERO_SCHEMA_TOO_NEW') throw err
      log(`base de ${tenantId} descartada (${errorCode(err) ?? 'error'}); se reconstruye desde el backend`)
      removeDbFiles(file)
      db = attempt()
    }
    return new SqliteCatalogStore(tenantId, file, db)
  }

  private get conn(): Db {
    if (!this.db) throw new Error('La caché de catálogo está cerrada')
    return this.db
  }

  private meta(resource: CatalogResource): (CatalogMeta & { payloadHash: string }) | null {
    const row = this.conn
      .prepare('SELECT last_sync_at, payload_hash, item_count FROM sync_meta WHERE resource = ?')
      .get(resource) as { last_sync_at: string; payload_hash: string; item_count: number } | undefined
    return row
      ? { resource, lastSyncAt: row.last_sync_at, payloadHash: row.payload_hash, itemCount: row.item_count }
      : null
  }

  getMeta(resource: CatalogResource): CatalogMeta | null {
    const m = this.meta(resource)
    return m ? { resource: m.resource, lastSyncAt: m.lastSyncAt, itemCount: m.itemCount } : null
  }

  private snapshot<T>(
    resource: CatalogResource,
    items: T[],
    now: Date,
    replace: (db: Db, items: T[]) => void,
  ): SnapshotResult {
    const lastSyncAt = now.toISOString()
    const hash = sha256(JSON.stringify(items))
    const previous = this.meta(resource)
    const upsertMeta = this.conn.prepare(
      `INSERT INTO sync_meta (resource, last_sync_at, payload_hash, item_count) VALUES (?, ?, ?, ?)
       ON CONFLICT(resource) DO UPDATE SET last_sync_at = excluded.last_sync_at,
         payload_hash = excluded.payload_hash, item_count = excluded.item_count`,
    )

    // Sin cambios: no se reescribe nada, solo se actualiza la fecha del último sync.
    if (previous && previous.payloadHash === hash) {
      upsertMeta.run(resource, lastSyncAt, hash, items.length)
      return { written: false, itemCount: items.length, lastSyncAt }
    }

    this.conn.transaction(() => {
      replace(this.conn, items)
      upsertMeta.run(resource, lastSyncAt, hash, items.length)
    })()
    return { written: true, itemCount: items.length, lastSyncAt }
  }

  replaceProducts(items: ProductLike[], now: Date = new Date()): SnapshotResult {
    return this.snapshot('products', items, now, (db, list) => {
      db.exec('DELETE FROM products')
      const insert = db.prepare(`INSERT INTO products (id, code, barcode, json) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET code = excluded.code, barcode = excluded.barcode, json = excluded.json`)
      for (const p of list) insert.run(String(p.id), String(p.code), p.barcode == null ? null : String(p.barcode), JSON.stringify(p))
    })
  }

  replacePromotions(items: PromotionLike[], now: Date = new Date()): SnapshotResult {
    return this.snapshot('promotions', items, now, (db, list) => {
      db.exec('DELETE FROM promotions')
      const insert = db.prepare(`INSERT INTO promotions (id, json) VALUES (?, ?)
       ON CONFLICT(id) DO UPDATE SET json = excluded.json`)
      for (const p of list) insert.run(String(p.id), JSON.stringify(p))
    })
  }

  /**
   * Inserta o actualiza. Usa ON CONFLICT DO UPDATE (no INSERT OR REPLACE): REPLACE borra y reinserta la fila y la
   * MOVERÍA AL FINAL, alterando el orden de la lista que el backend devolvió.
   */
  upsertProduct(item: ProductLike): void {
    this.conn
      .prepare(`INSERT INTO products (id, code, barcode, json) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET code = excluded.code, barcode = excluded.barcode, json = excluded.json`)
      .run(String(item.id), String(item.code), item.barcode == null ? null : String(item.barcode), JSON.stringify(item))
  }

  getProducts(): string[] {
    return (this.conn.prepare('SELECT json FROM products ORDER BY rowid').all() as { json: string }[]).map((r) => r.json)
  }

  getPromotions(): string[] {
    return (this.conn.prepare('SELECT json FROM promotions ORDER BY rowid').all() as { json: string }[]).map((r) => r.json)
  }

  findProduct(code: string): string | null {
    const value = String(code)
    for (const column of ['code', 'barcode', 'id'] as const) {
      const row = this.conn.prepare(`SELECT json FROM products WHERE ${column} = ? LIMIT 1`).get(value) as
        | { json: string }
        | undefined
      if (row) return row.json
    }
    return null
  }

  close(): void {
    if (!this.db) return
    try {
      this.db.close()
    } finally {
      this.db = null
    }
  }

  wipe(): void {
    this.close()
    removeDbFiles(this.file)
  }
}

/** Borra los archivos de la base de un tenant sin abrirla (logout: la caché puede no estar abierta en este proceso). */
export function wipeTenantFiles(dataDir: string, tenantId: string): void {
  removeDbFiles(resolveDbPath(dataDir, tenantId))
}
