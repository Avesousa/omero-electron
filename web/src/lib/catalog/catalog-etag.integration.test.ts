// @vitest-environment node
/**
 * Ciclos del syncer contra un backend HTTP REAL (con ETag y delta de stock, como omero-backend#86) y SQLite REAL:
 * primer ciclo 200, segundo 304 sin reescritura, cambio de stock → delta → siguiente ciclo 304, cambio de catálogo →
 * 200 completo, 410 → catálogo completo, backend sin soporte = comportamiento de antes y aislamiento entre tenants.
 */
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeAllCatalogStores, getCatalogStore } from './store-registry'
import { CatalogSyncer } from './syncer'

const TENANT_A = '724c4579-ea83-4cef-9f37-bcfbfcc12268'
const TENANT_B = '11111111-2222-3333-4444-555555555555'

function token(tenantId: string): string {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
  return `Bearer ${b64({ alg: 'HS256' })}.${b64({ tenantId, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`
}
const authA = token(TENANT_A)
const authB = token(TENANT_B)

interface FakeTenant {
  cat: number
  stock: number
  products: { id: number; code: string; name: string; stock: number }[]
  changes: { version: number; code: string; stock: number }[]
  deltaStatus: number
}
const newTenant = (): FakeTenant => ({
  cat: 1,
  stock: 10,
  products: [
    { id: 1, code: '001', name: 'Coca', stock: 10 },
    { id: 2, code: '002', name: 'Agua', stock: 5 },
  ],
  changes: [],
  deltaStatus: 200,
})

const backend = {
  etags: true,
  tenants: new Map<string, FakeTenant>(),
  requests: [] as { tenant: string; path: string; inm: string | undefined }[],
}

const server = http.createServer((req, res) => {
  const auth = String(req.headers.authorization)
  const tenant = auth === authA ? TENANT_A : auth === authB ? TENANT_B : null
  const url = new URL(req.url!, 'http://backend')
  const state = tenant ? backend.tenants.get(tenant) : undefined
  if (!tenant || !state) {
    res.writeHead(401)
    return res.end()
  }
  const inm = req.headers['if-none-match'] as string | undefined
  backend.requests.push({ tenant, path: url.pathname + url.search, inm })
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers })
    res.end(JSON.stringify(body))
  }

  if (url.pathname === '/api/products/stock') {
    if (!backend.etags) return json({ success: false }, 404)
    if (state.deltaStatus !== 200) return json({ success: false, code: 'STOCK_DELTA_EXPIRED' }, state.deltaStatus)
    const since = Number(url.searchParams.get('since'))
    return json({ success: true, data: { version: state.stock, items: state.changes.filter((c) => c.version > since).map(({ code, stock }) => ({ code, stock })) } })
  }
  if (url.pathname === '/api/products') {
    const etag = `"${state.cat}-${state.stock}"`
    if (backend.etags && inm === etag) {
      res.writeHead(304, { ETag: etag })
      return res.end()
    }
    return json({ success: true, data: state.products }, 200, backend.etags ? { ETag: etag } : {})
  }
  if (url.pathname === '/api/promotions') {
    if (backend.etags && inm === '"promo-1"') {
      res.writeHead(304, { ETag: '"promo-1"' })
      return res.end()
    }
    return json({ success: true, data: [{ id: 'p1', name: '2x1' }] }, 200, backend.etags ? { ETag: '"promo-1"' } : {})
  }
  const cfg = /^\/api\/business\/config\/([A-Za-z0-9_]+)$/.exec(url.pathname)
  if (cfg) {
    if (backend.etags && inm === '"cfg"') {
      res.writeHead(304, { ETag: '"cfg"' })
      return res.end()
    }
    return json({ success: true, data: { key: cfg[1], value: 'true' } }, 200, backend.etags ? { ETag: '"cfg"' } : {})
  }
  return json({ success: false }, 404) // medios de pago / clientes: opcionales, 404 no es fallo
})

/** Cambia el stock de un código en el backend falso (sube la versión de stock global). */
function sell(state: FakeTenant, code: string, stock: number) {
  state.stock += 1
  state.changes.push({ version: state.stock, code, stock })
  state.products.find((p) => p.code === code)!.stock = stock
}

let dataDir: string
let syncer: CatalogSyncer

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
})
afterAll(async () => {
  server.closeAllConnections()
  await new Promise((r) => server.close(r))
})
beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omero-etag-int-'))
  backend.etags = true
  backend.requests = []
  backend.tenants = new Map([
    [TENANT_A, newTenant()],
    [TENANT_B, newTenant()],
  ])
  vi.stubEnv('OMERO_RUNTIME', 'desktop')
  vi.stubEnv('BACKEND_URL', `http://127.0.0.1:${(server.address() as AddressInfo).port}`)
  vi.stubEnv('OMERO_DATA_DIR', dataDir)
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('OMERO_SQLITE_BINDING', '')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  syncer = new CatalogSyncer({
    getStore: (t) => getCatalogStore(t),
    backendUrl: () => process.env.BACKEND_URL!,
    log: () => {},
  })
  syncer.remember(TENANT_A, authA)
  syncer.remember(TENANT_B, authB)
})
afterEach(() => {
  syncer.stop()
  closeAllCatalogStores()
  fs.rmSync(dataDir, { recursive: true, force: true })
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

const requestsOf = (tenant: string, p: string) => backend.requests.filter((r) => r.tenant === tenant && (r.path === p || r.path.startsWith(`${p}?`) || r.path.startsWith(`${p}/`) && p !== '/api/products'))
const rowsOf = (tenant: string) => getCatalogStore(tenant)!.getProducts().map((j) => JSON.parse(j) as { code: string; stock: number })

describe('ciclos del syncer con ETag', () => {
  it('ciclo 1: 200 completo y ETags guardados; ciclo 2: todo 304 sin reescribir datos', async () => {
    await syncer.syncAll()
    const store = getCatalogStore(TENANT_A)!
    expect(store.getEtag('products')).toBe('"1-10"')
    expect(store.getEtag('promotions')).toBe('"promo-1"')
    expect(store.getEtag('setting:mp_offline')).toBe('"cfg"')
    const rewrite = vi.spyOn(store, 'replaceProducts')
    const first = store.getMeta('products')!.lastSyncAt

    await new Promise((r) => setTimeout(r, 5))
    await syncer.syncAll()
    expect(rewrite).not.toHaveBeenCalled()
    expect(requestsOf(TENANT_A, '/api/products').map((r) => r.inm)).toEqual([undefined, '"1-10"'])
    expect(requestsOf(TENANT_A, '/api/promotions').map((r) => r.inm)).toEqual([undefined, '"promo-1"'])
    expect(Date.parse(store.getMeta('products')!.lastSyncAt)).toBeGreaterThan(Date.parse(first))
    expect(syncer.online).toBe(true)
    expect(syncer.inRecovery).toBe(false)
    // medios de pago y clientes no son condicionales
    expect(requestsOf(TENANT_A, '/api/payment-methods').every((r) => r.inm === undefined)).toBe(true)
  })

  it('cambia el stock → delta (con since) → SQLite al día → el ciclo siguiente vuelve a dar 304', async () => {
    await syncer.syncAll()
    sell(backend.tenants.get(TENANT_A)!, '001', 7)

    await syncer.syncAll()
    expect(requestsOf(TENANT_A, '/api/products/stock').map((r) => r.path)).toEqual(['/api/products/stock?since=10'])
    expect(rowsOf(TENANT_A).find((p) => p.code === '001')!.stock).toBe(7)
    expect(getCatalogStore(TENANT_A)!.getEtag('products')).toBe('"1-11"')
    // el catálogo NO se bajó otra vez: el ETag recompuesto coincidió y el backend respondió 304
    expect(requestsOf(TENANT_A, '/api/products').map((r) => r.inm)).toEqual([undefined, '"1-11"'])

    await syncer.syncAll()
    expect(requestsOf(TENANT_A, '/api/products/stock').map((r) => r.path)).toEqual(['/api/products/stock?since=10', '/api/products/stock?since=11'])
    expect(requestsOf(TENANT_A, '/api/products').map((r) => r.inm)).toEqual([undefined, '"1-11"', '"1-11"'])
  })

  it('cambia el catálogo → 200 completo con ETag nuevo', async () => {
    await syncer.syncAll()
    const a = backend.tenants.get(TENANT_A)!
    a.cat = 2
    a.products.push({ id: 3, code: '003', name: 'Pan', stock: 1 })

    await syncer.syncAll()
    expect(rowsOf(TENANT_A).map((p) => p.code)).toEqual(['001', '002', '003'])
    expect(getCatalogStore(TENANT_A)!.getEtag('products')).toBe('"2-10"')
  })

  it('delta 410 → se borra el ETag y se baja el catálogo completo en el mismo ciclo', async () => {
    await syncer.syncAll()
    const a = backend.tenants.get(TENANT_A)!
    sell(a, '002', 1)
    a.deltaStatus = 410

    await syncer.syncAll()
    expect(requestsOf(TENANT_A, '/api/products').map((r) => r.inm)).toEqual([undefined, undefined]) // sin condicional
    expect(rowsOf(TENANT_A).find((p) => p.code === '002')!.stock).toBe(1)
    expect(getCatalogStore(TENANT_A)!.getEtag('products')).toBe('"1-11"')
  })

  it('backend sin soporte (sin ETag ni delta): se comporta como antes, siempre catálogo completo', async () => {
    backend.etags = false
    await syncer.syncAll()
    await syncer.syncAll()
    const store = getCatalogStore(TENANT_A)!
    expect(store.getEtag('products')).toBeNull()
    expect(requestsOf(TENANT_A, '/api/products').map((r) => r.inm)).toEqual([undefined, undefined])
    expect(requestsOf(TENANT_A, '/api/products/stock')).toEqual([])
    expect(store.getProducts()).toHaveLength(2)
    expect(syncer.inRecovery).toBe(false)
  })

  it('un backend que deja de mandar ETag después de haberlo mandado vuelve al comportamiento anterior', async () => {
    await syncer.syncAll()
    backend.etags = false
    await syncer.syncAll() // delta 404 → ETag borrado → 200 sin ETag
    await syncer.syncAll()
    expect(getCatalogStore(TENANT_A)!.getEtag('products')).toBeNull()
    expect(requestsOf(TENANT_A, '/api/products').map((r) => r.inm)).toEqual([undefined, undefined, undefined])
  })

  it('los tenants están aislados: el stock de uno no toca el ETag ni los datos del otro', async () => {
    await syncer.syncAll()
    sell(backend.tenants.get(TENANT_A)!, '001', 3)
    await syncer.syncAll()

    expect(rowsOf(TENANT_A).find((p) => p.code === '001')!.stock).toBe(3)
    expect(rowsOf(TENANT_B).find((p) => p.code === '001')!.stock).toBe(10)
    expect(getCatalogStore(TENANT_A)!.getEtag('products')).toBe('"1-11"')
    expect(getCatalogStore(TENANT_B)!.getEtag('products')).toBe('"1-10"')
    expect(requestsOf(TENANT_B, '/api/products/stock').map((r) => r.path)).toEqual(['/api/products/stock?since=10'])
    expect(requestsOf(TENANT_B, '/api/products').map((r) => r.inm)).toEqual([undefined, '"1-10"'])
    expect(fs.existsSync(path.join(dataDir, `${TENANT_A}.sqlite`))).toBe(true)
    expect(fs.existsSync(path.join(dataDir, `${TENANT_B}.sqlite`))).toBe(true)
  })
})
