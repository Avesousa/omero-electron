import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import type { BuildConfig } from './config'

/**
 * Lee resources/build-config.json (generado en el build del instalador).
 * Empaquetado: <dir del exe>/resources/build-config.json. Dev: <repo>/resources/build-config.json.
 * Devuelve null si no existe o es ilegible (el llamador decide si eso es un error).
 */
export function readBuildConfig(): BuildConfig | null {
  const root = app.isPackaged
    ? path.dirname(app.getPath('exe'))
    : path.join(__dirname, '../../')
  const file = path.join(root, 'resources', 'build-config.json')
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as BuildConfig
  } catch {
    return null
  }
}
