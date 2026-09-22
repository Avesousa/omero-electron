import { refreshLocalSession } from '@/lib/device/session-api'

// Renueva en silencio el JWT con el secreto de la caja (fase 4). Sin Authorization: el JWT del renderer ya venció.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  return refreshLocalSession(request)
}
