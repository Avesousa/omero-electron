// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeAllOutboxStores, getOutboxStore } from './outbox-registry'
import { adjustStockBody } from './stock-adjust'
import { handleApiRequest } from '../data-layer'
import { closeAllCatalogStores } from '../catalog/store-registry'
import { getSyncer } from '../catalog/syncer'

vi.mock('./outbox-sender', () => ({ getSender: () => ({ kick: vi.fn() }) }))

const TENANT = '724c4579-ea83-4cef-9f37-bcfbfcc12268'
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
const AUTH = `Bearer ${b64({ alg: 'HS256' })}.${b64({ tenantId: TENANT, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`

const sale = (items: [string, number][]) =>
  JSON.stringify({ items: items.map(([productId, quantity]) => ({ productId, quantity, unitPrice: 10, total: 10 * quantity })), cashAmount: 0, mpAmount: 0, change: 0 })

const list = (rows: { code: string; stock: number; sellingPrice?: number }[]) =>
  JSON.stringify({ success: true, data: rows.map((r, i) => ({ id: i + 1, ...r })) })

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omero-stock-'))
  vi.stubEnv('OMERO_RUNTIME', 'desktop')
  vi.stubEnv('BACKEND_URL', 'http://127.0.0.1:9')
  vi.stubEnv('OMERO_DATA_DIR', dir)
})
afterEach(() => {
  closeAllOutboxStores()
  closeAllCatalogStores()
  getSyncer().forget(TENANT)
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('adjustStockBody', () => {
  it('sin ventas activas devuelve el MISMO texto (camino rápido)', () => {
    getOutboxStore(TENANT)
    const body = list([{ code: '001', stock: 5 }])
    expect(adjustStockBody(TENANT, { kind: 'products' }, body)).toBe(body)
  })

  it('resta lo pendiente por código, con piso en 0, sin tocar precios ni otros productos', () => {
    const store = getOutboxStore(TENANT)!
    store.enqueue({ type: 'SALE', payload: sale([['001', 2], ['002', 10]]) })
    store.enqueue({ type: 'SALE', payload: sale([['001', 1], ['000', 5]]) })
    const out = JSON.parse(
      adjustStockBody(TENANT, { kind: 'products' }, list([
        { code: '001', stock: 10, sellingPrice: 99 },
        { code: '002', stock: 4, sellingPrice: 5 },
        { code: '003', stock: 7 },
        { code: '000', stock: 0 },
      ])),
    )
    expect(out.data).toEqual([
      { id: 1, code: '001', stock: 7, sellingPrice: 99 },
      { id: 2, code: '002', stock: 0, sellingPrice: 5 }, // piso en 0
      { id: 3, code: '003', stock: 7 },
      { id: 4, code: '000', stock: 0 },
    ])
  })

  it('ajusta un producto individual', () => {
    getOutboxStore(TENANT)!.enqueue({ type: 'SALE', payload: sale([['001', 3]]) })
    const out = JSON.parse(adjustStockBody(TENANT, { kind: 'product', code: '001' }, JSON.stringify({ success: true, data: { code: '001', stock: 5 } })))
    expect(out.data.stock).toBe(2)
  })

  it('respuesta en vivo: SENT no se descuenta de nuevo (el backend ya lo incluye)', () => {
    const store = getOutboxStore(TENANT)!
    const sent = store.enqueue({ type: 'SALE', payload: sale([['001', 4]]) }).row
    store.markSent(sent.clientId, { serverId: '1', sentAt: new Date().toISOString() })
    const body = list([{ code: '001', stock: 10 }])
    expect(adjustStockBody(TENANT, { kind: 'products' }, body)).toBe(body)
  })

  it('desde caché: lo enviado DESPUÉS del snapshot sí se descuenta; lo anterior no', () => {
    const store = getOutboxStore(TENANT)!
    const old = store.enqueue({ type: 'SALE', payload: sale([['001', 1]]) }).row
    const recent = store.enqueue({ type: 'SALE', payload: sale([['001', 2]]) }).row
    store.markSent(old.clientId, { serverId: '1', sentAt: '2026-01-01T09:00:00.000Z' })
    store.markSent(recent.clientId, { serverId: '2', sentAt: '2026-01-01T11:00:00.000Z' })
    const out = JSON.parse(adjustStockBody(TENANT, { kind: 'products' }, list([{ code: '001', stock: 10 }]), { since: '2026-01-01T10:00:00.000Z' }))
    expect(out.data[0].stock).toBe(8) // solo la de las 11:00
  })

  it.each([
    ['rutas que no son de productos', { kind: 'promotions' as const }, list([{ code: '001', stock: 5 }])],
    ['JSON inválido', { kind: 'products' as const }, '<html>'],
    ['data que no es lista ni objeto', { kind: 'products' as const }, JSON.stringify({ success: true, data: null })],
    ['stock no numérico', { kind: 'products' as const }, JSON.stringify({ success: true, data: [{ code: '001', stock: 'x' }] })],
  ])('%s → devuelve el body intacto', (_n, route, body) => {
    getOutboxStore(TENANT)!.enqueue({ type: 'SALE', payload: sale([['001', 1]]) })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(adjustStockBody(TENANT, route, body)).toBe(body)
  })

  it('sin outbox disponible devuelve el body intacto', () => {
    vi.stubEnv('OMERO_RUNTIME', 'web')
    const body = list([{ code: '001', stock: 5 }])
    expect(adjustStockBody(TENANT, { kind: 'products' }, body)).toBe(body)
  })
})

describe('integración con handleApiRequest', () => {
  const get = (p: string) => new Request(`http://localhost:3000${p}`, { headers: { authorization: AUTH } })
  const backendOk = (body: string) =>
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }))

  it('online: muestra backend − pendientes, y la caché guarda el valor CRUDO', async () => {
    getOutboxStore(TENANT)!.enqueue({ type: 'SALE', payload: sale([['001', 3]]) })
    backendOk(list([{ code: '001', stock: 10 }]))

    const res = await handleApiRequest(get('/api/products'))
    expect((await res.json()).data[0].stock).toBe(7)

    // sin conexión: sale de la caché (crudo 10) y se ajusta UNA sola vez → 7 (no 4)
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'))
    const offline = await handleApiRequest(get('/api/products'))
    expect(offline.headers.get('X-Omero-Cache')).toBe('hit')
    expect((await offline.json()).data[0].stock).toBe(7)
  })

  it('cuando la venta pasa a SENT y el backend ya la descontó, no se resta dos veces', async () => {
    const store = getOutboxStore(TENANT)!
    const row = store.enqueue({ type: 'SALE', payload: sale([['001', 3]]) }).row
    store.markSent(row.clientId, { serverId: '1', sentAt: new Date().toISOString() })
    backendOk(list([{ code: '001', stock: 7 }])) // el backend ya bajó de 10 a 7
    const res = await handleApiRequest(get('/api/products'))
    expect((await res.json()).data[0].stock).toBe(7)
  })
})
