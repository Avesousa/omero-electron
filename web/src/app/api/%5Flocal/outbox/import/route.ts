import { importLegacy } from '@/lib/outbox/local-api'

// Importa al outbox la cola vieja de localStorage (`omero_purchase_queue`). Idempotente.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  return importLegacy(request)
}
