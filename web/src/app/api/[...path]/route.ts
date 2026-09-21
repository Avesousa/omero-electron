import { handleApiRequest } from '@/lib/data-layer'

// /api/* → capa de datos (proxy runtime al omero-backend; en desktop, catálogo con caché SQLite).
// BACKEND_URL se lee en cada request, no en el build.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const handler = (request: Request) => handleApiRequest(request)

export {
  handler as GET,
  handler as POST,
  handler as PUT,
  handler as PATCH,
  handler as DELETE,
  handler as OPTIONS,
  handler as HEAD,
}
