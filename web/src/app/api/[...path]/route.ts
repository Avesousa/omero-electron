import { proxyToBackend } from '@/lib/backend-proxy'

// Proxy runtime /api/* → omero-backend (BACKEND_URL se lee en cada request, no en el build).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const handler = (request: Request) => proxyToBackend(request)

export {
  handler as GET,
  handler as POST,
  handler as PUT,
  handler as PATCH,
  handler as DELETE,
  handler as OPTIONS,
  handler as HEAD,
}
