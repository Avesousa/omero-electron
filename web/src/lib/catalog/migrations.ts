/**
 * Migraciones de la base SQLite de catálogo (una por tenant).
 *
 * Reglas:
 * - La versión de esquema vive en `PRAGMA user_version` y es igual al `version` de la última migración aplicada.
 * - NUNCA se edita una migración ya publicada: se agrega una nueva al final del array.
 * - Cada migración corre dentro de una transacción (ver sqlite-store.ts).
 */
export interface Migration {
  version: number
  description: string
  sql: string
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    description: 'products, promotions y sync_meta',
    sql: `
      CREATE TABLE products (
        id      TEXT PRIMARY KEY,   -- String(product.id)
        code    TEXT NOT NULL,
        barcode TEXT,               -- String(product.barcode) o NULL
        json    TEXT NOT NULL       -- ProductResponseDto tal como lo devolvió el backend
      );
      CREATE INDEX idx_products_code    ON products(code);
      CREATE INDEX idx_products_barcode ON products(barcode);

      CREATE TABLE promotions (
        id   TEXT PRIMARY KEY,
        json TEXT NOT NULL
      );

      CREATE TABLE sync_meta (
        resource     TEXT PRIMARY KEY,   -- 'products' | 'promotions'
        last_sync_at TEXT NOT NULL,      -- ISO-8601 UTC
        payload_hash TEXT NOT NULL,      -- sha256 del último snapshot
        item_count   INTEGER NOT NULL
      );
    `,
  },
  {
    version: 2,
    description: 'settings (configuración de negocio, p. ej. mp_offline)',
    sql: `
      CREATE TABLE settings (
        key       TEXT PRIMARY KEY,   -- clave de business_config (alfanumérica/_)
        json      TEXT NOT NULL,      -- BusinessConfigEntryDto tal como lo devolvió el backend
        synced_at TEXT NOT NULL       -- ISO-8601 UTC
      );
    `,
  },
]

/** Versión de esquema más nueva que conoce este build. */
export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version
