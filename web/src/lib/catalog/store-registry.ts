import { createRequire } from 'node:module'
import path from 'node:path'
import { getDataDir, getRuntime, getSqliteBinding } from '../runtime'
import { SqliteCatalogStore, wipeTenantFiles } from './sqlite-store'
import type { CatalogStore } from './types'

/**
 * Registro de stores de catálogo (uno por tenant) del proceso del Next.
 *
 * Reglas:
 * - Solo existe en modo desktop y con directorio de datos; en web NUNCA se carga el módulo nativo.
 * - `better-sqlite3` se carga de forma lazy con `createRequire` (ver `defaultLoader`). Si falta o no
 *   carga (ABI equivocado, no instalado) se degrada: se devuelve null y el POS sigue por proxy directo.
 * - Cualquier error al abrir una base → null (log una sola vez). La caché jamás debe romper una request.
 * - Estado en `globalThis` para sobrevivir a recargas de módulos en dev.
 */

type DatabaseConstructor = typeof import('better-sqlite3')
type Env = Record<string, string | undefined>
export type DatabaseLoader = () => DatabaseConstructor

interface RegistryState {
  stores: Map<string, CatalogStore>
  warned: Set<string>
}

const globalRef = globalThis as typeof globalThis & { __omeroCatalogRegistry?: RegistryState }

function state(): RegistryState {
  return (globalRef.__omeroCatalogRegistry ??= { stores: new Map(), warned: new Set() })
}

function warnOnce(key: string, message: string): void {
  const s = state()
  if (s.warned.has(key)) return
  s.warned.add(key)
  console.warn(`[catalog] ${message}`)
}

/**
 * Carga de `better-sqlite3` con `createRequire` y NO con `require('better-sqlite3')` estático: es una dependencia
 * OPCIONAL y en el modo web (Docker/Alpine) puede no estar instalada. Con un require estático Turbopack intenta
 * resolverlo en build y falla con "Module not found". Así el bundler no lo ve y solo se resuelve en runtime, desde el
 * `cwd` del proceso (dev: web/; Docker: /app; Electron: resources/frontend, donde prepare-frontend lo copia).
 */
const defaultLoader: DatabaseLoader = () => {
  const nodeRequire = createRequire(path.join(/* turbopackIgnore: true */ process.cwd(), 'noop.js'))
  return nodeRequire('better-sqlite3') as DatabaseConstructor
}

/** Store del tenant, o null si no aplica o no se pudo abrir (pass-through). */
export function getCatalogStore(
  tenantId: string,
  env: Env = process.env,
  loadDatabase: DatabaseLoader = defaultLoader,
): CatalogStore | null {
  let runtime: string
  try {
    runtime = getRuntime(env)
  } catch {
    return null
  }
  if (runtime !== 'desktop') return null

  const dataDir = getDataDir(env)
  if (!dataDir) {
    warnOnce('no-data-dir', 'OMERO_DATA_DIR no está definida: sin caché de catálogo')
    return null
  }

  const existing = state().stores.get(tenantId)
  if (existing) return existing

  let Database: DatabaseConstructor
  try {
    Database = loadDatabase()
  } catch (err) {
    warnOnce('native', `no se pudo cargar better-sqlite3 (${(err as Error).message}): sin caché de catálogo`)
    return null
  }

  try {
    const store = SqliteCatalogStore.open({ dataDir, tenantId, Database, nativeBinding: getSqliteBinding(env) })
    state().stores.set(tenantId, store)
    return store
  } catch (err) {
    warnOnce(`open:${tenantId}`, `no se pudo abrir la caché del tenant (${(err as Error).message}): sin caché`)
    return null
  }
}

/** Cierra el handle del tenant (si estaba abierto). */
export function closeCatalogStore(tenantId: string): void {
  const s = state()
  s.stores.get(tenantId)?.close()
  s.stores.delete(tenantId)
}

/**
 * Cierra y borra la base del tenant (logout). Funciona aunque no estuviera abierta en este proceso.
 * Devuelve false si no hay directorio de datos configurado (nada que borrar).
 */
export function wipeCatalogStore(tenantId: string, env: Env = process.env): boolean {
  closeCatalogStore(tenantId)
  const dataDir = getDataDir(env)
  if (!dataDir) return false
  wipeTenantFiles(dataDir, tenantId)
  return true
}

/** Cierra todos los handles (tests / apagado). */
export function closeAllCatalogStores(): void {
  const s = state()
  for (const store of s.stores.values()) store.close()
  s.stores.clear()
  s.warned.clear()
}
