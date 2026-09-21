import { checkBackend } from '@/lib/catalog/connectivity'
import { getCatalogStore } from '@/lib/catalog/store-registry'
import { getSyncer } from '@/lib/catalog/syncer'
import { tenantFromAuthHeader } from '@/lib/catalog/tenant'
import { getRuntime } from '@/lib/runtime'

// Estado de la conexión con el backend + estado de la caché de catálogo (para el aviso del POS).
// Solo VERIFICA la conexión: no sincroniza, no envía datos ni toca la caché.
// La carpeta se llama `%5Flocal` (ver api/%5Flocal/health): la URL es /api/_local/connectivity.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const status = await checkBackend()
  getSyncer().setOnline(status.online) // pasivo: el syncer lo usa para decidir el sondeo de recuperación

  let mode: 'web' | 'desktop' = 'web'
  try {
    mode = getRuntime()
  } catch {
    /* entorno inválido: instrumentation ya lo habría detenido */
  }

  let cache: null | {
    lastSyncAt: string | null
    ageSeconds: number | null
    products: number
    promotions: number
  } = null

  if (mode === 'desktop') {
    const tenantId = tenantFromAuthHeader(request.headers.get('authorization'))
    const store = tenantId ? getCatalogStore(tenantId) : null
    if (store) {
      const products = store.getMeta('products')
      const promotions = store.getMeta('promotions')
      const lastSyncAt = products?.lastSyncAt ?? null
      cache = {
        lastSyncAt,
        ageSeconds: lastSyncAt ? Math.max(0, Math.floor((Date.now() - Date.parse(lastSyncAt)) / 1000)) : null,
        products: products?.itemCount ?? 0,
        promotions: promotions?.itemCount ?? 0,
      }
    }
  }

  return Response.json(
    { online: status.online, checkedAt: status.checkedAt, latencyMs: status.latencyMs, runtime: mode, cache },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
