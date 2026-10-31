import { loginHintAvailable, parseLoginHint, readLoginHint, writeLoginHint } from '@/lib/login-hint/store'

// Pista de login de la caja (tenant del último login + si ofrece clave numérica). Local, sin secretos, no se proxea.
// La carpeta se llama `%5Flocal`: la URL es /api/_local/login-hint.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** `available:false` en web / sin directorio de datos: el renderer usa su localStorage. */
export async function GET() {
  const available = loginHintAvailable()
  return Response.json({ success: true, data: { available, hint: available ? readLoginHint() : null } })
}

export async function PUT(request: Request) {
  if (!loginHintAvailable()) return Response.json({ success: true, data: { available: false } })
  let body: unknown
  try {
    body = await request.json()
  } catch {
    body = null
  }
  const hint = parseLoginHint(body)
  if (!hint) return Response.json({ success: false, error: 'Datos de login inválidos.' }, { status: 400 })
  const saved = writeLoginHint(hint)
  return Response.json({ success: true, data: { available: true, saved } })
}
