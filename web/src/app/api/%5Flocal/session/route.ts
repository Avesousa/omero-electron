import { getLocalSession, logoutLocalSession } from '@/lib/device/session-api'

// Estado de la caja para la UI y logout de la caja. La carpeta se llama `%5Flocal`: la URL es /api/_local/session.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  return getLocalSession(request)
}

export async function DELETE(request: Request) {
  return logoutLocalSession(request)
}
