import fs from 'fs'
import path from 'path'
import { RESOURCES_DIR } from './paths'
import type { BuildConfig } from './config'

/**
 * Lee resources/build-config.json (generado en el build del instalador).
 * Ubicación: <RESOURCES_DIR>/build-config.json (ver paths.ts).
 * Devuelve null si no existe o es ilegible (el llamador decide si eso es un error).
 */
export function readBuildConfig(): BuildConfig | null {
  const file = path.join(RESOURCES_DIR, 'build-config.json')
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as BuildConfig
  } catch {
    return null
  }
}
