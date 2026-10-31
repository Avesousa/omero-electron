import { parseTheme, readUiPrefs, uiPrefsAvailable, writeTheme } from '@/lib/ui-prefs/store'

// Preferencias de interfaz de la caja (tema). Local, sin secretos, no se proxea. URL: /api/_local/ui-prefs
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** `available:false` en web / sin directorio de datos: el renderer usa su localStorage. */
export async function GET() {
  const available = uiPrefsAvailable()
  return Response.json({ success: true, data: { available, ...(available ? readUiPrefs() : {}) } })
}

export async function PUT(request: Request) {
  if (!uiPrefsAvailable()) return Response.json({ success: true, data: { available: false } })
  let body: unknown
  try {
    body = await request.json()
  } catch {
    body = null
  }
  const theme = parseTheme(body !== null && typeof body === 'object' ? (body as Record<string, unknown>).theme : null)
  if (!theme) return Response.json({ success: false, error: 'Tema inválido.' }, { status: 400 })
  return Response.json({ success: true, data: { available: true, saved: writeTheme(theme) } })
}
