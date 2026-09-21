import { wipeCatalogStore } from '@/lib/catalog/store-registry'
import { getSyncer } from '@/lib/catalog/syncer'
import { tenantFromAuthHeader } from '@/lib/catalog/tenant'
import { getRuntime } from '@/lib/runtime'

// Borra la caché de catálogo del tenant (lo invoca el logout del POS). El 401 por expiración NO la borra.
// La carpeta se llama `%5Flocal`: la URL es /api/_local/cache.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function DELETE(request: Request) {
  let mode: 'web' | 'desktop' = 'web'
  try {
    mode = getRuntime()
  } catch {
    /* se trata como web */
  }
  if (mode !== 'desktop') return new Response(null, { status: 204 }) // web: no hay caché, no-op

  const tenantId = tenantFromAuthHeader(request.headers.get('authorization'))
  if (!tenantId) {
    return Response.json({ success: false, error: 'Falta una sesión válida.' }, { status: 401 })
  }

  try {
    getSyncer().forget(tenantId)
    wipeCatalogStore(tenantId)
    return new Response(null, { status: 204 })
  } catch (err) {
    console.error(`[catalog] no se pudo borrar la caché: ${(err as Error).message}`)
    return Response.json({ success: false, error: 'No se pudo borrar la caché local.' }, { status: 500 })
  }
}
