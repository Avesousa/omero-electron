import fs from 'node:fs'
import path from 'node:path'
import { getDataDir, getRuntime } from '../runtime'

/**
 * Preferencias de interfaz de la caja (solo desktop): hoy, el tema claro/oscuro. Van en
 * `<OMERO_DATA_DIR>/ui-prefs.json` por la misma razón que la pista de login: el localStorage del renderer es por
 * origen (incluye el puerto) y el Next local puede levantar en otro (3000, 3001…). Es device-level: sobrevive a
 * reinicios y al logout. Ilegible o inválido = "sin preferencia" (se usa el tema por defecto). Jamás lanza.
 *
 * Electron (main) lee este mismo archivo para pintar el splash con el tema correcto: si cambia el nombre o el
 * formato, actualizar `main/ui-prefs.ts`.
 */

export type Theme = 'light' | 'dark'
export interface UiPrefs {
  theme?: Theme
}

type Env = Record<string, string | undefined>

const FILE = 'ui-prefs.json'

function dirFor(env: Env): string | null {
  try {
    if (getRuntime(env) !== 'desktop') return null
    return getDataDir(env)
  } catch {
    return null
  }
}

export function uiPrefsAvailable(env: Env = process.env): boolean {
  return dirFor(env) !== null
}

export function parseTheme(raw: unknown): Theme | null {
  return raw === 'light' || raw === 'dark' ? raw : null
}

export function readUiPrefs(env: Env = process.env): UiPrefs {
  const dir = dirFor(env)
  if (!dir) return {}
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(path.join(dir, FILE), 'utf8'))
    const theme = raw !== null && typeof raw === 'object' ? parseTheme((raw as Record<string, unknown>).theme) : null
    return theme ? { theme } : {}
  } catch {
    return {}
  }
}

/** Guarda el tema (conserva el resto del archivo). false si no se pudo. */
export function writeTheme(theme: Theme, env: Env = process.env): boolean {
  const dir = dirFor(env)
  if (!dir) return false
  try {
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, FILE)
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify({ ...readUiPrefs(env), theme }))
    fs.renameSync(tmp, file)
    return true
  } catch (err) {
    console.warn(`[ui-prefs] no se pudo persistir el tema: ${(err as Error).message}`)
    return false
  }
}
