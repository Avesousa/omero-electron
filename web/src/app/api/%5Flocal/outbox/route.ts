import { listOutbox } from '@/lib/outbox/local-api'

// Estado y lista del outbox de ventas/gastos del tenant de la sesión (solo lectura, no se proxea al backend).
// La carpeta se llama `%5Flocal` (ver api/%5Flocal/health): la URL es /api/_local/outbox.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  return listOutbox(request)
}
