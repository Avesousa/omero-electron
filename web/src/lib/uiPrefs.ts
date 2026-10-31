/**
 * Preferencias de interfaz — lado renderer. En desktop el tema vive en el Next local (`/api/_local/ui-prefs`, archivo
 * en el userData: sobrevive a reinicios, al logout y a un cambio de puerto). En web, en `localStorage`.
 * Todo es best-effort y con timeout: NADA de esto puede demorar ni romper la pantalla.
 */

export type Theme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'omero-theme-v2'
const TIMEOUT_MS = 2_000

function asTheme(v: unknown): Theme | null {
  return v === 'light' || v === 'dark' ? v : null
}

async function timedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    return await fetch(input, { ...init, cache: 'no-store', signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** Tema guardado en el dispositivo (desktop), o null si no hay / no aplica / falla. Nunca lanza. */
export async function loadDeviceTheme(): Promise<Theme | null> {
  try {
    const res = await timedFetch('/api/_local/ui-prefs')
    const body = (await res.json()) as { success?: boolean; data?: { available?: boolean; theme?: unknown } }
    return body?.success && body.data?.available ? asTheme(body.data.theme) : null
  } catch {
    return null
  }
}

/** Guarda el tema elegido: localStorage siempre; además el archivo del dispositivo en desktop. Nunca lanza. */
export async function saveTheme(theme: Theme): Promise<void> {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    /* sin storage: se pierde la comodidad, no la pantalla */
  }
  try {
    await timedFetch('/api/_local/ui-prefs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme }),
    })
  } catch {
    /* web / servidor local ausente */
  }
}
