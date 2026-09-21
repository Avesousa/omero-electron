/**
 * Tipos de la caché de catálogo del POS desktop (SQLite, solo lectura).
 * Ver AiBuild/feature/pos-sqlite-catalog-cache/ (functional-spec y technical-spec).
 */

/** Recursos de catálogo que se cachean. */
export type CatalogResource = 'products' | 'promotions'

/** Lecturas del backend que la capa de datos sabe servir desde la caché. */
export type CatalogRoute =
  | { kind: 'products' } // GET /api/products (lista completa, sin query)
  | { kind: 'product'; code: string } // GET /api/products/{code}
  | { kind: 'promotions' } // GET /api/promotions (lista completa, sin query)

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
  /** Reemplaza TODOS los productos en una transacción (detecta eliminados). */
  replaceProducts(items: ProductLike[], now?: Date): SnapshotResult
  /** Reemplaza TODAS las promociones en una transacción. */
  replacePromotions(items: PromotionLike[], now?: Date): SnapshotResult
  /** Inserta/actualiza un producto (lookup por código); no elimina nada. */
  upsertProduct(item: ProductLike): void
  /** JSON crudo de cada producto (en el orden de inserción). */
  getProducts(): string[]
  getPromotions(): string[]
  /** Busca por código → código de barras → id (mismo orden que `findProductByCode` del POS). */
  findProduct(code: string): string | null
  getMeta(resource: CatalogResource): CatalogMeta | null
  close(): void
  /** Cierra y borra los archivos de la base (.sqlite, -wal, -shm). */
  wipe(): void
}
