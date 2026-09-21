import { getDataDir, getRuntime, getSqliteBinding } from '../runtime'
import { defaultLoader, type DatabaseLoader } from '../catalog/store-registry'
import { OutboxStore } from './outbox-store'

/**
 * Registro de outboxes (uno por tenant) del proceso del Next. Solo desktop y con directorio de datos; misma
 * degradación que la caché: si falta el módulo nativo, el directorio o falla la apertura devuelve null y el POS
 * sigue por proxy directo (sin encolar). Estado en `globalThis` (sobrevive a recargas de módulos en dev).
 */

type Env = Record<string, string | undefined>

interface RegistryState {
  stores: Map<string, OutboxStore>
  warned: Set<string>
}

const globalRef = globalThis as typeof globalThis & { __omeroOutboxRegistry?: RegistryState }

function state(): RegistryState {
  return (globalRef.__omeroOutboxRegistry ??= { stores: new Map(), warned: new Set() })
}

function warnOnce(key: string, message: string): void {
  const s = state()
  if (s.warned.has(key)) return
  s.warned.add(key)
  console.warn(`[outbox] ${message}`)
}

export function getOutboxStore(
  tenantId: string,
  env: Env = process.env,
  loadDatabase: DatabaseLoader = defaultLoader,
): OutboxStore | null {
  let runtime: string
  try {
    runtime = getRuntime(env)
  } catch {
    return null
  }
  if (runtime !== 'desktop') return null

  const dataDir = getDataDir(env)
  if (!dataDir) {
    warnOnce('no-data-dir', 'OMERO_DATA_DIR no está definida: las ventas NO se encolan (proxy directo)')
    return null
  }

  const existing = state().stores.get(tenantId)
  if (existing) return existing

  try {
    const Database = loadDatabase()
    const store = OutboxStore.open({ dataDir, tenantId, Database, nativeBinding: getSqliteBinding(env) })
    state().stores.set(tenantId, store)
    return store
  } catch (err) {
    warnOnce(`open:${tenantId}`, `no se pudo abrir el outbox del tenant (${(err as Error).message}): proxy directo`)
    return null
  }
}

/** Cierra el handle del tenant (no borra nada: el outbox sobrevive al logout). */
export function closeOutboxStore(tenantId: string): void {
  const s = state()
  s.stores.get(tenantId)?.close()
  s.stores.delete(tenantId)
}

export function closeAllOutboxStores(): void {
  const s = state()
  for (const store of s.stores.values()) store.close()
  s.stores.clear()
  s.warned.clear()
}
