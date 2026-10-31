/**
 * Migraciones del outbox (una base por tenant, archivo aparte de la caché del catálogo).
 * Igual que en la caché: `PRAGMA user_version`, nunca se edita una migración publicada.
 */
export interface OutboxMigration {
  version: number
  description: string
  sql: string
}

export const OUTBOX_MIGRATIONS: readonly OutboxMigration[] = [
  {
    version: 1,
    description: 'outbox y outbox_meta',
    sql: `
      CREATE TABLE outbox (
        seq             INTEGER PRIMARY KEY AUTOINCREMENT,   -- orden de envío (más viejo primero)
        client_id       TEXT    NOT NULL UNIQUE,             -- UUID: idempotencia en el backend
        type            TEXT    NOT NULL CHECK (type IN ('SALE','EXPENSE')),
        payload         TEXT    NOT NULL,                    -- JSON del request original (sin costo)
        created_at      TEXT    NOT NULL,                    -- ISO UTC, hora de la caja
        source_user_id  TEXT,                                -- cajero (informativo)
        status          TEXT    NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING','SENT','REVIEW','FAILED')),
        attempts        INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TEXT,
        sent_at         TEXT,                                -- cuándo el backend lo confirmó
        server_id       TEXT,                                -- id de la venta/gasto creado
        review_json     TEXT,                                -- reasons/detalle devueltos por el backend
        error           TEXT,                                -- motivo de REJECTED / fallo permanente
        dismissed_at    TEXT                                 -- FAILED que el usuario ya vio y descartó
      );
      CREATE INDEX idx_outbox_status ON outbox(status, seq);

      CREATE TABLE outbox_meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
]

export const LATEST_OUTBOX_SCHEMA_VERSION = OUTBOX_MIGRATIONS[OUTBOX_MIGRATIONS.length - 1].version
