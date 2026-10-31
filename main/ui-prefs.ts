import fs from 'fs'
import path from 'path'

/**
 * Tema (claro/oscuro) guardado por el POS en `<dataDir>/ui-prefs.json` (lo escribe el Next local, ver
 * web/src/lib/ui-prefs/store.ts). Electron solo lo LEE para pintar la pantalla de carga con el tema correcto antes de
 * que exista la página. Cualquier problema (sin archivo, ilegible, valor raro) = 'light', el tema por defecto.
 */
export type Theme = 'light' | 'dark'

export const UI_PREFS_FILE = 'ui-prefs.json'

export function readSavedTheme(dataDir: string): Theme {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(path.join(dataDir, UI_PREFS_FILE), 'utf8'))
    return raw !== null && typeof raw === 'object' && (raw as { theme?: unknown }).theme === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

/** Colores de fondo por tema (los mismos `--c-bg` de la app), para la ventana y la pantalla de carga. */
export const THEME_BACKGROUND: Record<Theme, string> = { light: '#F0F4F8', dark: '#041329' }
