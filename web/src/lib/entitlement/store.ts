import fs from 'node:fs'
import path from 'node:path'
import { getDataDir, getRuntime } from '../runtime'
import { parseCached, type CachedEntitlement, type Entitlement } from './rule'

/**
 * Caché PERSISTENTE del entitlement (solo desktop): `<OMERO_DATA_DIR>/<tenantId>.entitlement.json`, junto al resto del
 * estado de la caja. Sobrevive a reinicios, así una caja offline recién abierta sabe hasta cuándo puede vender.
 *
 * - JSON chico, escritura atómica (tmp + rename). Archivo ilegible o con forma inválida = "sin caché" (se ignora y se
 *   pisa con la próxima consulta): jamás rompe una request ni bloquea al cajero.
 * - Espejo en memoria en `globalThis` (sobrevive a recargas de módulos en dev) para no leer disco en cada venta.
 * - El `tenantId` ya viene validado como UUID (`tenantFromAuthHeader`), por eso es seguro como nombre de archivo.
 */

type Env = Record<string, string | undefined>

const globalRef = globalThis as typeof globalThis & { __omeroEntitlementCache?: Map<string, CachedEntitlement> }
const memory = (): Map<string, CachedEntitlement> => (globalRef.__omeroEntitlementCache ??= new Map())

/** Directorio a usar, o null si no aplica (web, o producción sin `OMERO_DATA_DIR`). */
function dirFor(env: Env): string | null {
  try {
    if (getRuntime(env) !== 'desktop') return null
    return getDataDir(env)
  } catch {
    return null
  }
}

const fileFor = (dir: string, tenantId: string) => path.join(dir, `${tenantId}.entitlement.json`)

/** Último entitlement conocido del tenant (memoria → disco), o null. Nunca lanza. */
export function readEntitlement(tenantId: string, env: Env = process.env): CachedEntitlement | null {
  const hit = memory().get(tenantId)
  if (hit) return hit
  const dir = dirFor(env)
  if (!dir) return null
  try {
    const cached = parseCached(JSON.parse(fs.readFileSync(fileFor(dir, tenantId), 'utf8')))
    if (cached) memory().set(tenantId, cached)
    return cached
  } catch {
    return null // no existe, ilegible o inválido
  }
}

/** Guarda el entitlement recién obtenido del backend con su `fetchedAt`. Best-effort: nunca lanza. */
export function writeEntitlement(
  tenantId: string,
  entitlement: Entitlement,
  now: number = Date.now(),
  env: Env = process.env,
): CachedEntitlement | null {
  const dir = dirFor(env)
  if (!dir) return null
  const cached: CachedEntitlement = { entitlement, fetchedAt: new Date(now).toISOString() }
  memory().set(tenantId, cached)
  try {
    fs.mkdirSync(dir, { recursive: true })
    const file = fileFor(dir, tenantId)
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(cached))
    fs.renameSync(tmp, file)
  } catch (err) {
    console.warn(`[entitlement] no se pudo persistir la caché: ${(err as Error).message}`) // queda en memoria
  }
  return cached
}

/** Solo para tests. */
export function resetEntitlementMemory(): void {
  memory().clear()
}
