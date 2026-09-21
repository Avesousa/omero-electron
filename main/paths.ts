import { app } from 'electron'
import path from 'path'

/**
 * Carpeta `resources/` de la app (donde electron-builder deja los extraResources: frontend, native, build-config).
 * Empaquetado usa `process.resourcesPath`, que es correcto en ambas plataformas:
 *   Windows: <instalación>/resources        macOS: Omero POS.app/Contents/Resources
 * (`dirname(exe)/resources` solo funciona en Windows.) En desarrollo: <repo>/resources.
 */
export const RESOURCES_DIR = app.isPackaged
  ? process.resourcesPath
  : path.join(__dirname, '../../resources')
