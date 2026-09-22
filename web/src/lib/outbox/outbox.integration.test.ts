// @vitest-environment node
/**
 * Integración del outbox del POS desktop contra un backend HTTP REAL (falso pero con el contrato de la tech-spec) y
 * SQLite REAL (archivos temporales): intercepción de la venta, envío, reintentos, autenticación, aislamiento por
 * tenant, stock mostrado, cola vieja, endpoints locales, modo web y degradación.
 */
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DELETE as deleteCache } from '../../app/api/%5Flocal/cache/route'
import { GET as getOutbox } from '../../app/api/%5Flocal/outbox/route'
import { POST as importQueue } from '../../app/api/%5Flocal/outbox/import/route'
import { handleApiRequest } from '../data-layer'
import { closeAllCatalogStores } from '../catalog/store-registry'
import { getSyncer } from '../catalog/syncer'
import { closeAllOutboxStores, getOutboxStore } from './outbox-registry'
import { getSender, resetSender } from './outbox-sender'

const TENANT_A = '724c4579-ea83-4cef-9f37-bcfbfcc12268'
const TENANT_B = '11111111-2222-3333-4444-555555555555'

function token(tenantId: string, exp = Math.floor(Date.now() / 1000) + 3600): string {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
  return `Bearer ${b64({ alg: 'HS256' })}.${b64({ tenantId, userId: '99999999-aaaa-bbbb-cccc-000000000001', exp })}.sig`
}
const authA = token(TENANT_A)
const authB = token(TENANT_B)

// ── backend falso ────────────────────────────────────────────────────────────
type Mode = 'ok' | 401 | 403 | 404 | 500 | 'reset' | 'lose-response'
const backend = {
  mode: 'ok' as Mode,
  batches: [] as { auth: string | undefined; items: { clientId: string; type: string; createdAt: string; sale?: { items: { productId: string }[] } }[] }[],
  created: new Map<string, string>(), // clientId → id
  products: [] as { id: number; code: string; name: string; stock: number }[],
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url!, 'http://backend')
  const chunks: Buffer[] = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (url.pathname === '/api/health') return json(200, { status: 'UP' })
    if (url.pathname === '/api/products') return json(200, { success: true, data: backend.products })

    if (url.pathname === '/api/sync/batch' && req.method === 'POST') {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      backend.batches.push({ auth: req.headers.authorization, items: body.items })
      if (backend.mode === 'reset') return req.socket.destroy()
      if (typeof backend.mode === 'number') return json(backend.mode, { success: false, error: `modo ${backend.mode}` })

      const results = body.items.map((i: (typeof backend.batches)[0]['items'][0]) => {
        const codes = i.sale?.items.map((x) => x.productId) ?? []
        if (codes.includes('BAD')) return { clientId: i.clientId, status: 'REJECTED', error: { code: 'VALIDATION', message: 'Cantidad inválida' } }
        if (codes.includes('BOOM')) return { clientId: i.clientId, status: 'REJECTED', error: { code: 'INTERNAL_ERROR', message: 'boom' } }
        const existing = backend.created.get(i.clientId)
        if (existing) return { clientId: i.clientId, status: 'DUPLICATE', entityId: existing }
        const id = String(backend.created.size + 1)
        backend.created.set(i.clientId, id)
        const review = codes.includes('999')
          ? { status: 'NEEDS_REVIEW', reasons: ['PRODUCT_NOT_FOUND'], items: [{ productCode: '999', problem: 'PRODUCT_NOT_FOUND' }] }
          : undefined
        return { clientId: i.clientId, status: 'CREATED', entityId: id, ...(review ? { review } : {}) }
      })
      if (backend.mode === 'lose-response') return req.socket.destroy() // guardó pero la respuesta se pierde
      return json(200, { success: true, data: { results } })
    }
    return json(404, { success: false, error: 'no existe' })
  })
})

let dataDir: string
let backendUrl: string

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  backendUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(async () => {
  server.closeAllConnections()
  await new Promise((r) => server.close(r))
})

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omero-outbox-int-'))
  backend.mode = 'ok'
  backend.batches = []
  backend.created = new Map()
  backend.products = [{ id: 1, code: '001', name: 'Coca', stock: 10 }]
  vi.stubEnv('OMERO_RUNTIME', 'desktop')
  vi.stubEnv('BACKEND_URL', backendUrl)
  vi.stubEnv('OMERO_DATA_DIR', dataDir)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  resetSender()
  getSyncer().stop()
  for (const t of [TENANT_A, TENANT_B]) getSyncer().forget(t)
  closeAllOutboxStores()
  closeAllCatalogStores()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

const saleBody = (code = '001', qty = 1) => ({
  items: [{ productId: code, productName: `Prod ${code}`, quantity: qty, unitPrice: 100, total: 100 * qty, promotionId: null, promotionName: null }],
  cashAmount: 100 * qty, mpAmount: 0, change: 0,
})
const post = (p: string, body: unknown, auth: string | null = authA) =>
  new Request(`http://localhost:3000${p}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify(body),
  })
const get = (p: string, auth: string | null = authA) =>
  new Request(`http://localhost:3000${p}`, { headers: auth ? { authorization: auth } : {} })

const sell = async (code = '001', qty = 1, auth = authA) => {
  const res = await handleApiRequest(post('/api/sales', saleBody(code, qty), auth))
  return { res, data: (await res.clone().json()).data as { clientId: string; queued: boolean } }
}
const outboxRow = (clientId: string, tenant = TENANT_A) => getOutboxStore(tenant)!.getByClientId(clientId)!
/** Espera (tiempo real) a que una condición se cumpla. */
const until = async (cond: () => boolean, ms = 3000) => {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout esperando la condición')
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe('venta → outbox → backend', () => {
  it('201 inmediato, queda en SQLite y se sube sola (SENT)', async () => {
    const { res, data } = await sell()
    expect(res.status).toBe(201)
    expect(data.queued).toBe(true)
    expect(outboxRow(data.clientId).createdAt).toBeTruthy()

    await until(() => outboxRow(data.clientId).status === 'SENT')
    expect(outboxRow(data.clientId).serverId).toBe('1')
    expect(backend.batches).toHaveLength(1)
    expect(backend.batches[0].auth).toBe(authA)
    expect(JSON.stringify(backend.batches[0].items)).not.toMatch(/cost/i)
    expect(backend.batches[0].items[0]).toMatchObject({ type: 'SALE', clientId: data.clientId })
  })

  it('un gasto viaja por el mismo camino', async () => {
    const res = await handleApiRequest(post('/api/expenses', { description: 'Bolsas', amount: 20, type: 'GENERAL' }))
    const { clientId } = (await res.json()).data
    await until(() => outboxRow(clientId).status === 'SENT')
    expect(backend.batches[0].items[0].type).toBe('EXPENSE')
  })

  it('venta con producto inexistente → REVIEW con el detalle del backend', async () => {
    const { data } = await sell('999')
    await until(() => outboxRow(data.clientId).status === 'REVIEW')
    expect(JSON.parse(outboxRow(data.clientId).reviewJson!).reasons).toEqual(['PRODUCT_NOT_FOUND'])
  })

  it('resultado mixto: FAILED, REVIEW, SENT y INTERNAL_ERROR (se reintenta)', async () => {
    backend.mode = 500 // primero acumula sin enviar
    const a = (await sell('BAD')).data.clientId
    const b = (await sell('999')).data.clientId
    const c = (await sell('001')).data.clientId
    const d = (await sell('BOOM')).data.clientId
    await until(() => backend.batches.length >= 1)
    backend.mode = 'ok'
    getSender().handleSyncerEvent({ type: 'online' })

    await until(() => outboxRow(c).status === 'SENT')
    expect(outboxRow(a)).toMatchObject({ status: 'FAILED', error: 'Cantidad inválida' })
    expect(outboxRow(b).status).toBe('REVIEW')
    expect(outboxRow(d).status).toBe('PENDING') // INTERNAL_ERROR: sigue pendiente
    // orden: del más viejo al más nuevo
    const order = backend.batches.at(-1)!.items.map((i) => i.clientId)
    expect(order).toEqual([a, b, c, d])
  })
})

describe('reintentos y conexión', () => {
  it('backend caído (5xx) → queda PENDING; al recuperarse se sube sin duplicar', async () => {
    backend.mode = 500
    const { data } = await sell()
    await until(() => backend.batches.length === 1)
    await until(() => getSender().state(TENANT_A).backend === 'offline')
    expect(outboxRow(data.clientId).status).toBe('PENDING')
    expect(getSender().state(TENANT_A).nextAttemptAt).not.toBeNull()

    backend.mode = 'ok'
    getSender().handleSyncerEvent({ type: 'online' }) // el syncer detectó que volvió
    await until(() => outboxRow(data.clientId).status === 'SENT')
    expect(backend.created.size).toBe(1)
  })

  it('conexión cortada (reset) también reintenta', async () => {
    backend.mode = 'reset'
    const { data } = await sell()
    await until(() => backend.batches.length === 1)
    await until(() => getSender().state(TENANT_A).backend === 'offline')
    backend.mode = 'ok'
    getSender().handleSyncerEvent({ type: 'online' })
    await until(() => outboxRow(data.clientId).status === 'SENT')
  })

  it('respuesta perdida DESPUÉS de guardar: el reintento devuelve DUPLICATE y no duplica', async () => {
    backend.mode = 'lose-response'
    const { data } = await sell()
    await until(() => backend.created.size === 1)
    await until(() => getSender().state(TENANT_A).backend === 'offline')
    expect(outboxRow(data.clientId).status).toBe('PENDING') // el POS no sabe que llegó

    backend.mode = 'ok'
    getSender().handleSyncerEvent({ type: 'online' })
    await until(() => outboxRow(data.clientId).status === 'SENT')
    expect(backend.created.size).toBe(1)
    expect(outboxRow(data.clientId).serverId).toBe('1')
  })

  it('404 (backend viejo sin /api/sync/batch) → "unsupported" y nada se pierde', async () => {
    backend.mode = 404
    const { data } = await sell()
    await until(() => getSender().state(TENANT_A).backend === 'unsupported')
    expect(outboxRow(data.clientId).status).toBe('PENDING')
  })

  it('una venta hecha con el backend caído sigue mostrándose con el stock descontado', async () => {
    backend.mode = 500
    await sell('001', 3)
    await until(() => backend.batches.length === 1)
    // el catálogo se lee del backend (en vivo): 10 − 3 pendientes
    const res = await handleApiRequest(get('/api/products'))
    const list = (await res.json()).data as { code: string; stock: number }[]
    expect(list.find((p) => p.code === '001')!.stock).toBe(7)
  })
})

describe('autenticación', () => {
  it('401 detiene el envío y NO pierde nada; con un token nuevo se reanuda', async () => {
    backend.mode = 401
    const { data } = await sell()
    await until(() => getSender().state(TENANT_A).backend === 'unauthorized')
    expect(outboxRow(data.clientId).status).toBe('PENDING')
    expect(getSyncer().hasTenant(TENANT_A)).toBe(false) // olvidó el token vencido

    backend.mode = 'ok'
    const fresh = token(TENANT_A, Math.floor(Date.now() / 1000) + 7200)
    await handleApiRequest(post('/api/sales', saleBody('001', 1), fresh)) // nueva request autenticada = login vigente
    await until(() => outboxRow(data.clientId).status === 'SENT')
    expect(getSender().state(TENANT_A).backend).toBe('ok')
  })

  it('el tenant A jamás sube con el token del tenant B (y viceversa)', async () => {
    const a = (await sell('001', 1, authA)).data.clientId
    const b = (await sell('001', 1, authB)).data.clientId
    await until(() => outboxRow(a).status === 'SENT' && outboxRow(b, TENANT_B).status === 'SENT')
    const byAuth = (auth: string) => backend.batches.filter((x) => x.auth === auth).flatMap((x) => x.items.map((i) => i.clientId))
    expect(byAuth(authA)).toEqual([a])
    expect(byAuth(authB)).toEqual([b])
  })
})

describe('reinicio, logout y cola vieja', () => {
  it('reinicio con pendientes: al volver a ver un token, se suben', async () => {
    backend.mode = 500
    const { data } = await sell()
    await until(() => backend.batches.length === 1)
    // "reinicio": se pierde el estado en memoria (sender, syncer, handles); los datos siguen en disco
    resetSender()
    getSyncer().forget(TENANT_A)
    closeAllOutboxStores()

    backend.mode = 'ok'
    await handleApiRequest(get('/api/products')) // cualquier request autenticada
    getSyncer().remember(TENANT_A, authA) // el syncer publica el token nuevo
    await until(() => outboxRow(data.clientId).status === 'SENT')
  })

  it('el logout borra la caché de catálogo pero NO el outbox', async () => {
    backend.mode = 500
    const { data } = await sell()
    await handleApiRequest(get('/api/products')) // crea la caché de catálogo
    const res = await deleteCache(get('/api/_local/cache', authA) as never)
    expect(res.status).toBe(204)
    expect(fs.existsSync(path.join(dataDir, `${TENANT_A}.outbox.sqlite`))).toBe(true)
    closeAllOutboxStores()
    expect(outboxRow(data.clientId).status).toBe('PENDING')
  })

  it('la cola vieja se importa UNA sola vez y se sube', async () => {
    const legacy = { id: 'old-1', tenantId: TENANT_A, queuedAt: '2026-01-05T10:00:00.000Z', payload: saleBody('001', 2) }
    const send = () => importQueue(post('/api/_local/outbox/import', { items: [legacy] }))
    expect((await (await send()).json()).data.imported).toEqual(['old-1'])
    expect((await (await send()).json()).data.imported).toEqual(['old-1'])
    await until(() => backend.created.size === 1)
    expect(getOutboxStore(TENANT_A)!.list({ statuses: ['PENDING', 'SENT'] })).toHaveLength(1)
    expect(backend.batches[0].items[0].createdAt).toBe('2026-01-05T10:00:00.000Z')
  })
})

describe('endpoints locales', () => {
  it('GET /api/_local/outbox refleja conteos y estado; otro tenant no ve nada', async () => {
    backend.mode = 500
    await sell()
    await sell()
    await until(() => backend.batches.length >= 1)
    const a = (await (await getOutbox(get('/api/_local/outbox?limit=10'))).json()).data
    expect(a.counts.pending).toBe(2)
    expect(a.items).toHaveLength(2)
    const b = (await (await getOutbox(get('/api/_local/outbox', authB))).json()).data
    expect(b.counts.pending).toBe(0)
  })
})

describe('modo web y degradación', () => {
  it('web: POST /api/sales va directo al backend y no crea outbox', async () => {
    vi.stubEnv('OMERO_RUNTIME', 'web')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"success":true,"data":{"id":77}}', { status: 201, headers: { 'content-type': 'application/json' } }),
    )
    const res = await handleApiRequest(post('/api/sales', saleBody()))
    expect((await res.json()).data.id).toBe(77)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fs.readdirSync(dataDir)).toEqual([])
  })

  it('desktop sin outbox disponible (sin OMERO_DATA_DIR en producción): proxy directo', async () => {
    vi.stubEnv('OMERO_DATA_DIR', '')
    vi.stubEnv('NODE_ENV', 'production')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"success":true,"data":{"id":5}}', { status: 201, headers: { 'content-type': 'application/json' } }),
    )
    const res = await handleApiRequest(post('/api/sales', saleBody()))
    expect((await res.json()).data.id).toBe(5)
    expect(String(fetchSpy.mock.calls[0][0])).toBe(`${backendUrl}/api/sales`)
  })
})
