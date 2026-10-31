import fs from 'node:fs'
import path from 'node:path'
import { getDataDir, getRuntime } from '../runtime'

/**
 * "Pista de login" de la caja (solo desktop): el tenant con el que se hizo el último login con email + contraseña y si
 * ese negocio ofrece login con clave numérica. NO es un secreto (un UUID y un booleano), por eso va en claro en
 * `<OMERO_DATA_DIR>/login-hint.json` (= `<userData>/catalog-cache`, que sobrevive a reinicios). No se usa el
 * localStorage del renderer porque su origen incluye el puerto, y el Next local puede levantar en otro (3000, 3001…).
 *
 * Una caja = un negocio: el archivo guarda el último tenant. Escritura atómica (tmp + rename). Ilegible o inválido =
 * "sin pista" (login con email, que siempre funciona). Jamás lanza.
 */

export interface LoginHint {
  tenantId: string
  quickKeyLoginEnabled: boolean
}

type Env = Record<string, string | undefined>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FILE = 'login-hint.json'

/** Directorio a usar, o null si no aplica (web, o producción sin `OMERO_DATA_DIR`). */
function dirFor(env: Env): string | null {
  try {
    if (getRuntime(env) !== 'desktop') return null
    return getDataDir(env)
  } catch {
    return null
  }
}

/** ¿Este proceso puede persistir la pista? (desktop con directorio de datos). */
export function loginHintAvailable(env: Env = process.env): boolean {
  return dirFor(env) !== null
}

/** Valida y normaliza una pista venida de disco o de una request; null si no es válida. */
export function parseLoginHint(raw: unknown): LoginHint | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const { tenantId, quickKeyLoginEnabled } = raw as Record<string, unknown>
  if (typeof tenantId !== 'string' || !UUID.test(tenantId)) return null
  return { tenantId: tenantId.toLowerCase(), quickKeyLoginEnabled: quickKeyLoginEnabled === true }
}

export function readLoginHint(env: Env = process.env): LoginHint | null {
  const dir = dirFor(env)
  if (!dir) return null
  try {
    return parseLoginHint(JSON.parse(fs.readFileSync(path.join(dir, FILE), 'utf8')))
  } catch {
    return null // no existe, ilegible o inválido
  }
}

/** Guarda la pista. Devuelve false si no se pudo (sin directorio o error de disco). */
export function writeLoginHint(hint: LoginHint, env: Env = process.env): boolean {
  const dir = dirFor(env)
  if (!dir) return false
  try {
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, FILE)
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(hint))
    fs.renameSync(tmp, file)
    return true
  } catch (err) {
    console.warn(`[login-hint] no se pudo persistir la pista: ${(err as Error).message}`)
    return false
  }
}
