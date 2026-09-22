// @vitest-environment node
/**
 * Integración de la capa de datos (`handleApiRequest`) contra un backend HTTP REAL y SQLite REAL (archivos temporales).
 * Cubre la matriz de la technical-spec: online/offline, respuestas reales del backend, borrados, aislamiento por tenant,
 * endpoints locales, modo web y degradación.
 */
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DELETE as deleteCache } from '../../app/api/%5Flocal/cache/route'
import { GET as getConnectivity } from '../../app/api/%5Flocal/connectivity/route'
import { handleApiRequest } from '../data-layer'
import { closeAllCatalogStores, getCatalogStore } from './store-registry'
import { getSyncer } from './syncer'

const TENANT_A = '724c4579-ea83-4cef-9f37-bcfbfcc12268'
const TENANT_B = '11111111-2222-3333-4444-555555555555'

function token(tenantId: string | null): string {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
  const payload = { ...(tenantId ? { tenantId } : {}), exp: Math.floor(Date.now() / 1000) + 3600 }
  return `Bearer ${b64({ alg: 'HS256' })}.${b64(payload)}.sig`
}
const authA = token(TENANT_A)
const authB = token(TENANT_B)

// ── backend falso ────────────────────────────────────────────────────────────
type Mode = 'ok' | 401 | 403 | 404 | 500 | 502 | 503 | 504 | 'reset' | 'hang'
const backend = {
  mode: 'ok' as Mode,
  hits: [] as string[],
  products: [] as { id: number; code: string; name: string; barcode?: number | null }[],
  promotions: [] as { id: string; name: string }[],
  config: {} as Record<string, string>,
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url!, 'http://backend')
  backend.hits.push(`${req.method} ${url.pathname}${url.search}`)

  if (backend.mode === 'reset') return req.socket.destroy()
  if (backend.mode === 'hang') return // nunca responde
  if (backend.mode !== 'ok') {
    res.writeHead(backend.mode, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ success: false, error: `modo ${backend.mode}` }))
  }

  const json = (body: unknown, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  if (req.method === 'POST' && url.pathname === '/api/products') return json({ success: true, data: { id: 99 } }, 201)
  if (url.pathname === '/api/products') return json({ success: true, data: backend.products })
  if (url.pathname === '/api/promotions') return json({ success: true, data: backend.promotions })
  if (url.pathname === '/api/products/search') return json({ success: true, data: backend.products })
  const cfg = /^\/api\/business\/config\/([A-Za-z0-9_]+)$/.exec(url.pathname)
  if (cfg) return json({ success: true, data: { key: cfg[1], value: backend.config[cfg[1]] ?? 'false', type: 'boolean' } })
  const single = /^\/api\/products\/(\d+)$/.exec(url.pathname)
  if (single) {
    const p = backend.products.find((x) => x.code === single[1] || String(x.barcode) === single[1] || String(x.id) === single[1])
    return p ? json({ success: true, data: p }) : json({ success: false, error: 'Producto no encontrado' }, 404)
  }
  return json({ success: false, error: 'no existe' }, 404)
})

let dataDir: string

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
})
afterAll(async () => {
  server.closeAllConnections()
  await new Promise((r) => server.close(r))
})

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omero-catalog-int-'))
  backend.mode = 'ok'
  backend.hits = []
  backend.products = [
    { id: 0, code: '000', name: 'Precio libre' },
    { id: 1, code: '001', name: 'Coca Cola 2L', barcode: 7790001 },
    { id: 2, code: '002', name: 'Agua 1.5L' },
  ]
  backend.promotions = [{ id: 'promo-1', name: '2x1' }]
  backend.config = { mp_offline: 'true' }
  vi.stubEnv('OMERO_RUNTIME', 'desktop')
  vi.stubEnv('BACKEND_URL', `http://127.0.0.1:${(server.address() as AddressInfo).port}`)
  vi.stubEnv('OMERO_DATA_DIR', dataDir)
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('PROXY_TIMEOUT_MS', '')
  vi.stubEnv('OMERO_SQLITE_BINDING', '')
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  getSyncer().stop()
  getSyncer().forget(TENANT_A)
  getSyncer().forget(TENANT_B)
  closeAllCatalogStores()
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

const get = (pathname: string, auth: string | null = authA, init: RequestInit = {}) =>
  handleApiRequest(
    new Request(`http://localhost:3000${pathname}`, {
      ...init,
      headers: { ...(auth ? { Authorization: auth } : {}), ...(init.headers as Record<string, string> | undefined) },
    }),
  )
const list = async (res: Response) => (await res.json()).data as { id: number; code: string }[]

/** Deja la caché del tenant A poblada con products + promotions + un producto por código. */
async function warmCache(auth = authA) {
  await get('/api/products', auth)
  await get('/api/promotions', auth)
}

describe('online: read-through', () => {
  it('200 del backend pasa tal cual y deja el snapshot en SQLite', async () => {
    const res = await get('/api/products')
    expect(res.status).toBe(200)
    expect(res.headers.get('x-omero-cache')).toBeNull()
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(res.headers.has('content-length')).toBe(false) // el body se re-armó desde texto
    expect((await list(res)).map((p) => p.code)).toEqual(['000', '001', '002'])

    expect(fs.existsSync(path.join(dataDir, `${TENANT_A}.sqlite`))).toBe(true)
    const store = getCatalogStore(TENANT_A)!
    expect(store.getMeta('products')?.itemCount).toBe(3)
    expect(store.getProducts()).toHaveLength(3)
  })

  it('promociones online quedan cacheadas', async () => {
    await get('/api/promotions')
    expect(getCatalogStore(TENANT_A)!.getMeta('promotions')?.itemCount).toBe(1)
  })

  it('un request cacheable registra al tenant en el syncer', async () => {
    await get('/api/products')
    expect(getSyncer().hasTenant(TENANT_A)).toBe(true)
  })

  it('un producto eliminado en el backend desaparece tras el siguiente snapshot online', async () => {
    await get('/api/products')
    backend.products = backend.products.filter((p) => p.code !== '002')
    await get('/api/products')
    backend.mode = 503
    expect((await list(await get('/api/products'))).map((p) => p.code)).toEqual(['000', '001'])
  })

  it('el orden de la lista se conserva aunque se consulte un producto por código (regresión INSERT OR REPLACE)', async () => {
    await get('/api/products')
    await get('/api/products/000') // upsert del primero
    backend.mode = 503
    expect((await list(await get('/api/products'))).map((p) => p.code)).toEqual(['000', '001', '002'])
  })
})

describe('backend caído → sirve desde SQLite', () => {
  it.each([502, 503, 504] as const)('un %i del backend/gateway sirve la caché con sus headers', async (status) => {
    await warmCache()
    backend.mode = status
    const res = await get('/api/products')
    expect(res.status).toBe(200)
    expect(res.headers.get('x-omero-cache')).toBe('hit')
    expect(Date.parse(res.headers.get('x-omero-cache-at')!)).not.toBeNaN()
    expect(Number(res.headers.get('x-omero-cache-age'))).toBeGreaterThanOrEqual(0)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect((await list(res)).map((p) => p.code)).toEqual(['000', '001', '002'])
  })

  it('conexión cortada (ECONNRESET) → 502 del proxy → caché', async () => {
    await warmCache()
    backend.mode = 'reset'
    const res = await get('/api/products')
    expect(res.status).toBe(200)
    expect(res.headers.get('x-omero-cache')).toBe('hit')
  })

  it('backend que no responde (timeout) → 504 del proxy → caché', async () => {
    await warmCache()
    vi.stubEnv('PROXY_TIMEOUT_MS', '150')
    backend.mode = 'hang'
    const res = await get('/api/products')
    expect(res.headers.get('x-omero-cache')).toBe('hit')
    expect((await list(res)).map((p) => p.code)).toEqual(['000', '001', '002'])
  })

  it('el cuerpo servido desde caché es idéntico al del backend', async () => {
    const online = await (await get('/api/products')).json()
    backend.mode = 503
    const offline = await (await get('/api/products')).json()
    expect(offline).toEqual(online)
  })

  it('promociones desde caché', async () => {
    await warmCache()
    backend.mode = 503
    const res = await get('/api/promotions')
    expect(res.headers.get('x-omero-cache')).toBe('hit')
    expect((await res.json()).data).toEqual([{ id: 'promo-1', name: '2x1' }])
  })

  it('lookup por código, código de barras e id sin conexión', async () => {
    await warmCache()
    backend.mode = 503
    for (const key of ['001', '7790001', '2']) {
      const res = await get(`/api/products/${key}`)
      expect(res.status, key).toBe(200)
      expect(res.headers.get('x-omero-cache'), key).toBe('hit')
    }
    expect((await (await get('/api/products/001')).json()).data.name).toBe('Coca Cola 2L')
  })

  it('un producto consultado online por código queda disponible offline aunque no haya habido snapshot de la lista', async () => {
    await get('/api/products/001')
    backend.mode = 503
    const res = await get('/api/products/001')
    expect(res.status).toBe(200)
    expect(res.headers.get('x-omero-cache')).toBe('hit')
    // pero la LISTA no se sirve: nunca hubo un snapshot completo (sería una lista parcial)
    expect((await get('/api/products')).status).toBe(503)
  })

  it('código inexistente sin conexión → respuesta original del proxy (no inventa datos)', async () => {
    await warmCache()
    backend.mode = 503
    const res = await get('/api/products/99999')
    expect(res.status).toBe(503)
    expect(res.headers.get('x-omero-cache')).toBeNull()
  })

  it('sin datos locales (primer uso sin conexión) → 503 original', async () => {
    backend.mode = 503
    const res = await get('/api/products')
    expect(res.status).toBe(503)
    expect(res.headers.get('x-omero-cache')).toBeNull()
  })

  it('sin datos locales y backend inalcanzable → 502 del proxy', async () => {
    backend.mode = 'reset'
    expect((await get('/api/products')).status).toBe(502)
  })
})

describe('configuración de negocio (mp_offline)', () => {
  it('online pasa tal cual y queda cacheada; sin conexión se sirve desde SQLite', async () => {
    const online = await (await get('/api/business/config/mp_offline')).json()
    expect(online.data).toMatchObject({ key: 'mp_offline', value: 'true' })
    expect(getCatalogStore(TENANT_A)!.getSetting('mp_offline')).not.toBeNull()

    backend.mode = 503
    const res = await get('/api/business/config/mp_offline')
    expect(res.status).toBe(200)
    expect(res.headers.get('x-omero-cache')).toBe('hit')
    expect((await res.json()).data.value).toBe('true')
  })

  it('sin valor cacheado y sin conexión → 503 original', async () => {
    backend.mode = 503
    expect((await get('/api/business/config/mp_offline')).status).toBe(503)
  })

  it('un 404 real de una clave desconocida pasa sin tocar la caché', async () => {
    backend.mode = 404
    expect((await get('/api/business/config/otra')).status).toBe(404)
  })

  it('la lista completa de config no se cachea', async () => {
    backend.mode = 503
    expect((await get('/api/business/config')).status).toBe(503)
  })
})

describe('respuestas REALES del backend no usan la caché', () => {
  it.each([401, 403, 404, 500] as const)('un %i pasa sin modificar aunque haya caché', async (status) => {
    await warmCache()
    backend.mode = status
    const res = await get('/api/products')
    expect(res.status).toBe(status)
    expect(res.headers.get('x-omero-cache')).toBeNull()
    expect((await res.json()).error).toBe(`modo ${status}`)
  })

  it('un 404 real de un producto no se reemplaza por caché', async () => {
    await warmCache()
    const res = await get('/api/products/555')
    expect(res.status).toBe(404)
  })

  it('un 404/500 no borra ni modifica lo cacheado', async () => {
    await warmCache()
    backend.mode = 500
    await get('/api/products')
    backend.mode = 503
    expect(await list(await get('/api/products'))).toHaveLength(3)
  })
})

describe('rutas fuera de la política', () => {
  it.each(['/api/products/search?q=coca', '/api/products?categoryId=x', '/api/products/search'])(
    '%s no usa la caché (503 original)',
    async (url) => {
      await warmCache()
      backend.mode = 503
      const res = await get(url)
      expect(res.status).toBe(503)
      expect(res.headers.get('x-omero-cache')).toBeNull()
    },
  )

  it('las escrituras (POST) pasan sin tocar la caché ni el syncer', async () => {
    const res = await get('/api/products', authA, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } })
    expect(res.status).toBe(201)
    expect(fs.existsSync(path.join(dataDir, `${TENANT_A}.sqlite`))).toBe(false)
    expect(getSyncer().hasTenant(TENANT_A)).toBe(false)
  })

  it('otras lecturas (/api/sales) pasan directo', async () => {
    const res = await get('/api/sales')
    expect(res.status).toBe(404) // el backend falso no la conoce: llegó tal cual
    expect(fs.readdirSync(dataDir)).toEqual([])
  })
})

describe('aislamiento por tenant', () => {
  it('cada tenant tiene su base y no ve los datos del otro', async () => {
    await warmCache(authA)
    backend.mode = 503
    expect((await get('/api/products', authA)).headers.get('x-omero-cache')).toBe('hit')
    expect((await get('/api/products', authB)).status).toBe(503) // B nunca sincronizó
  })

  it('un JWT sin tenantId o inválido no usa caché (pass-through)', async () => {
    const noTenant = await get('/api/products', token(null))
    expect(noTenant.status).toBe(200)
    const garbage = await get('/api/products', 'Bearer abc.def.ghi')
    expect(garbage.status).toBe(200)
    const noAuth = await get('/api/products', null)
    expect(noAuth.status).toBe(200)
    expect(fs.readdirSync(dataDir)).toEqual([])
  })
})

describe('endpoints locales', () => {
  it('DELETE /api/_local/cache borra solo la base del tenant y olvida su token', async () => {
    await warmCache(authA)
    await warmCache(authB)
    const res = await deleteCache(new Request('http://localhost/api/_local/cache', { method: 'DELETE', headers: { Authorization: authA } }))
    expect(res.status).toBe(204)
    expect(fs.existsSync(path.join(dataDir, `${TENANT_A}.sqlite`))).toBe(false)
    expect(fs.existsSync(path.join(dataDir, `${TENANT_B}.sqlite`))).toBe(true)
    expect(getSyncer().hasTenant(TENANT_A)).toBe(false)
    expect(getSyncer().hasTenant(TENANT_B)).toBe(true)

    backend.mode = 503
    expect((await get('/api/products', authA)).status).toBe(503) // sin caché
    expect((await get('/api/products', authB)).headers.get('x-omero-cache')).toBe('hit')
  })

  it('DELETE sin sesión válida → 401; en web → 204 no-op', async () => {
    const noAuth = await deleteCache(new Request('http://localhost/api/_local/cache', { method: 'DELETE' }))
    expect(noAuth.status).toBe(401)
    vi.stubEnv('OMERO_RUNTIME', 'web')
    const web = await deleteCache(new Request('http://localhost/api/_local/cache', { method: 'DELETE' }))
    expect(web.status).toBe(204)
  })

  it('GET /api/_local/connectivity informa online + estado de la caché', async () => {
    await warmCache()
    const online = await (await getConnectivity(new Request('http://localhost/x', { headers: { Authorization: authA } }))).json()
    expect(online).toMatchObject({ online: false, runtime: 'desktop', cache: { products: 3, promotions: 1 } })
    // el backend falso no tiene /api/health: responde 404 → offline; ahora simulamos que existe
    expect(online.cache.lastSyncAt).toBeTruthy()
    expect(online.cache.ageSeconds).toBeGreaterThanOrEqual(0)
  })

  it('connectivity: online=true si /api/health responde 2xx; cache=null sin sesión o en web', async () => {
    const originalFetch = globalThis.fetch
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) =>
      String(input).endsWith('/api/health') ? new Response('{"status":"UP"}') : originalFetch(input, init),
    )
    const sinSesion = await (await getConnectivity(new Request('http://localhost/x'))).json()
    expect(sinSesion).toMatchObject({ online: true, runtime: 'desktop', cache: null })
    vi.stubEnv('OMERO_RUNTIME', 'web')
    const web = await (await getConnectivity(new Request('http://localhost/x', { headers: { Authorization: authA } }))).json()
    expect(web).toMatchObject({ online: true, runtime: 'web', cache: null })
  })

  it('connectivity: con base pero sin snapshot → lastSyncAt/ageSeconds null y contadores en 0', async () => {
    getCatalogStore(TENANT_A) // crea la base vacía
    const body = await (await getConnectivity(new Request('http://localhost/x', { headers: { Authorization: authA } }))).json()
    expect(body.cache).toEqual({ lastSyncAt: null, ageSeconds: null, products: 0, promotions: 0 })
  })
})

describe('modo web y degradación', () => {
  it('modo web: no se crea ninguna base ni se carga el módulo nativo', async () => {
    vi.stubEnv('OMERO_RUNTIME', 'web')
    const res = await get('/api/products')
    expect(res.status).toBe(200)
    expect(res.headers.get('x-omero-cache')).toBeNull()
    expect(fs.readdirSync(dataDir)).toEqual([])
    backend.mode = 503
    expect((await get('/api/products')).status).toBe(503) // web: sin caché, el error de siempre
  })

  it('sin OMERO_DATA_DIR (producción) → sin caché, el POS sigue funcionando', async () => {
    vi.stubEnv('OMERO_DATA_DIR', '')
    expect((await get('/api/products')).status).toBe(200)
    backend.mode = 503
    expect((await get('/api/products')).status).toBe(503)
  })

  it('binding nativo inexistente → degrada a pass-through sin error', async () => {
    vi.stubEnv('OMERO_SQLITE_BINDING', path.join(dataDir, 'no-existe.node'))
    const res = await get('/api/products')
    expect(res.status).toBe(200)
    expect(getCatalogStore(TENANT_A)).toBeNull()
  })

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('directorio sin permisos de escritura → degrada sin error', async () => {
    fs.chmodSync(dataDir, 0o500)
    try {
      const res = await get('/api/products')
      expect(res.status).toBe(200)
      expect(getCatalogStore(TENANT_A)).toBeNull()
    } finally {
      fs.chmodSync(dataDir, 0o700)
    }
  })

  it('entorno inválido (sin OMERO_RUNTIME) → se comporta como proxy directo', async () => {
    vi.stubEnv('OMERO_RUNTIME', '')
    expect((await get('/api/products')).status).toBe(200)
    expect(fs.readdirSync(dataDir)).toEqual([])
  })

  it('un payload 200 con forma inválida no corrompe la caché existente', async () => {
    await warmCache()
    const original = backend.products
    // el backend responde 200 pero con una lista de basura
    backend.products = [{ id: 7, name: 'sin code' } as never]
    const res = await get('/api/products')
    expect(res.status).toBe(200) // la respuesta pasa al POS igual
    backend.products = original
    backend.mode = 503
    expect((await list(await get('/api/products'))).map((p) => p.code)).toEqual(['000', '001', '002'])
  })
})
