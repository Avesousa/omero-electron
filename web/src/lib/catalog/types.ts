/**
 * Tipos de la caché de catálogo del POS desktop (SQLite, solo lectura).
 * Ver AiBuild/feature/pos-sqlite-catalog-cache/ (functional-spec y technical-spec).
 */

/** Recursos de catálogo que se cachean. */
export type CatalogResource = 'products' | 'promotions'

/** Lecturas del backend que la capa de datos sabe servir desde la caché. */
export type CatalogRoute =
  | { kind: 'products' } // GET /api/products (lista completa, sin query)
  | { kind: 'stockDelta'; since: number } // GET /api/products/stock?since=<n> (cambios de stock desde esa versión)
  | { kind: 'product'; code: string } // GET /api/products/{code}
  | { kind: 'promotions' } // GET /api/promotions (lista completa, sin query)
  | { kind: 'setting'; key: string } // GET /api/business/config/{key} (p. ej. mp_offline)
  | { kind: 'paymentMethods' } // GET /api/payment-methods/active (medios del cobro; se guarda como setting `payment_methods`)
  | { kind: 'customers' } // GET /api/customers?onlyActive=true (clientes activos con deuda; setting `customers`)
  | { kind: 'customerFields' } // GET /api/customers/fields (campos extra del cliente; setting `customer_fields`)
  | { kind: 'customerDetail'; id: string } // GET /api/customers/{uuid}/detail (setting `customer_detail_<uuid>`; solo al consultarse)

/** Metadatos del último snapshot exitoso de un recurso. */
export interface CatalogMeta {
  resource: CatalogResource
  /** ISO-8601 (UTC) del último snapshot exitoso. */
  lastSyncAt: string
  itemCount: number
}

export interface SnapshotResult {
  /** false si el payload no cambió (hash idéntico): solo se actualizó `lastSyncAt`. */
  written: boolean
  itemCount: number
  lastSyncAt: string
}

/** Forma mínima que necesita la caché de un producto del backend (ProductResponseDto). */
export interface ProductLike {
  id: number | string
  code: string
  barcode?: number | string | null
}

/** Forma mínima de una promoción del backend. */
export interface PromotionLike {
  id: number | string
}

/**
 * Caché de catálogo de UN tenant. Guarda el JSON crudo de cada ítem para servir exactamente el mismo
 * DTO que el backend. Las implementaciones no deben lanzar por datos vacíos; sí por errores de I/O.
 */
export interface CatalogStore {
  readonly tenantId: string
  /**
   * Reemplaza TODOS los productos en una transacción (detecta eliminados). `etag` se guarda en la MISMA transacción;
   * sin `etag` se borra el guardado (backend viejo: no hay validador).
   */
  replaceProducts(items: ProductLike[], now?: Date, etag?: string | null): SnapshotResult
  /** Reemplaza TODAS las promociones en una transacción (mismo criterio de `etag`). */
  replacePromotions(items: PromotionLike[], now?: Date, etag?: string | null): SnapshotResult
  /** ETag guardado de un recurso (`products` | `promotions` | `setting:<key>`). */
  getEtag(key: string): string | null
  /** Guarda el ETag de un recurso; `null` lo borra. */
  setEtag(key: string, etag: string | null): void
  /** Marca el recurso como sincronizado ahora (`sync_meta`/`settings`) sin reescribir datos. Sin fila previa no hace nada. */
  touch(key: string, now?: Date): void
  /** Aplica `{code, stock}` a los productos guardados en una transacción; ignora códigos desconocidos. Devuelve cuántos actualizó. */
  applyStockDelta(items: { code: string; stock: number }[]): number
  /** Inserta/actualiza un producto (lookup por código); no elimina nada. */
  upsertProduct(item: ProductLike): void
  /** JSON crudo de cada producto (en el orden de inserción). */
  getProducts(): string[]
  getPromotions(): string[]
  /** Busca por código → código de barras → id (mismo orden que `findProductByCode` del POS). */
  findProduct(code: string): string | null
  getMeta(resource: CatalogResource): CatalogMeta | null
  /** Configuración de negocio cacheada (JSON crudo del backend) y cuándo se sincronizó. */
  getSetting(key: string): { json: string; syncedAt: string } | null
  upsertSetting(key: string, json: string, now?: Date, etag?: string | null): void
  /** Borra las configuraciones cuya clave empieza con `prefix` y no está en `keep`. Devuelve cuántas borró. */
  deleteSettingsByPrefix(prefix: string, keep?: readonly string[]): number
  close(): void
  /** Cierra y borra los archivos de la base (.sqlite, -wal, -shm). */
  wipe(): void
}
