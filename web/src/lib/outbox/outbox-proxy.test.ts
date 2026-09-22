// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const kick = vi.fn()
vi.mock('./outbox-sender', () => ({ getSender: () => ({ kick }) }))

import { closeAllOutboxStores, getOutboxStore } from './outbox-registry'
import { handleOutboxRequest, matchOutboxRoute, MAX_BODY_BYTES } from './outbox-proxy'
import { handleApiRequest } from '../data-layer'
import { getSyncer } from '../catalog/syncer'

const TENANT = '724c4579-ea83-4cef-9f37-bcfbfcc12268'
const USER = '99999999-aaaa-bbbb-cccc-000000000001'

function token(claims: Record<string, unknown> = { tenantId: TENANT, userId: USER }): string {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
  return `Bearer ${b64({ alg: 'HS256' })}.${b64({ ...claims, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`
}
const post = (pathname: string, body: unknown, auth: string | null = token()) =>
  new Request(`http://localhost:3000${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

const goodSale = {
  items: [
    { productId: '001', productName: 'Coca', quantity: 2, unitPrice: 100, total: 200, promotionId: null, promotionName: null, unitCost: 5, cost: 7 },
  ],
  cashAmount: 200,
  mpAmount: 0,
  change: 0,
  costTotal: 10,
}

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omero-outbox-proxy-'))
  vi.stubEnv('OMERO_RUNTIME', 'desktop')
  vi.stubEnv('BACKEND_URL', 'http://127.0.0.1:9')
  vi.stubEnv('OMERO_DATA_DIR', dir)
  kick.mockClear()
})
afterEach(() => {
  closeAllOutboxStores()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  getSyncer().forget(TENANT)
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('matchOutboxRoute', () => {
  it.each([
    ['POST', '/api/sales', 'SALE'],
    ['post', '/api/sales/', 'SALE'],
    ['POST', '/api/expenses', 'EXPENSE'],
    ['GET', '/api/sales', null],
    ['POST', '/api/sales/5', null],
    ['POST', '/api/products', null],
    ['POST', '/api/sales/review', null],
  ])('%s %s → %s', (m, p, expected) => {
    expect(matchOutboxRoute(m, p)).toBe(expected)
  })
})

describe('venta', () => {
  it('guarda en el outbox ANTES de responder 201 queued y dispara el envío', async () => {
    const res = await handleOutboxRequest(post('/api/sales', goodSale), 'SALE')
    expect(res!.status).toBe(201)
    const body = await res!.json()
    expect(body).toMatchObject({ success: true, data: { id: null, queued: true, total: 200 } })
    expect(body.data.clientId).toMatch(/^[0-9a-f-]{36}$/)

    const row = getOutboxStore(TENANT)!.getByClientId(body.data.clientId)!
    expect(row).toMatchObject({ type: 'SALE', status: 'PENDING', sourceUserId: USER, createdAt: body.data.createdAt })
    expect(Math.abs(Date.parse(row.createdAt) - Date.now())).toBeLessThan(5000)
    expect(kick).toHaveBeenCalledWith(TENANT)
    expect(getSyncer().hasTenant(TENANT)).toBe(true) // el token queda en memoria para el sender
  })

  it('el payload guardado NO lleva costo ni campos desconocidos y conserva productName', async () => {
    const res = await handleOutboxRequest(post('/api/sales', goodSale), 'SALE')
    const { clientId } = (await res!.json()).data
    const payload = JSON.parse(getOutboxStore(TENANT)!.getByClientId(clientId)!.payload)
    expect(JSON.stringify(payload)).not.toMatch(/cost/i)
    expect(payload.items[0]).toEqual({
      productId: '001', productName: 'Coca', quantity: 2, unitPrice: 100, total: 200, promotionId: null, promotionName: null,
    })
    expect(payload).toMatchObject({ cashAmount: 200, mpAmount: 0, change: 0 })
  })

  it('cada venta recibe un clientId distinto', async () => {
    const a = (await (await handleOutboxRequest(post('/api/sales', goodSale), 'SALE'))!.json()).data.clientId
    const b = (await (await handleOutboxRequest(post('/api/sales', goodSale), 'SALE'))!.json()).data.clientId
    expect(a).not.toBe(b)
    expect(getOutboxStore(TENANT)!.counts().pending).toBe(2)
  })

  it.each([
    ['sin ítems', { ...goodSale, items: [] }],
    ['ítems no es lista', { ...goodSale, items: 'x' }],
    ['ítem no objeto', { ...goodSale, items: [5] }],
    ['sin código', { ...goodSale, items: [{ ...goodSale.items[0], productId: ' ' }] }],
    ['cantidad 0', { ...goodSale, items: [{ ...goodSale.items[0], quantity: 0 }] }],
    ['cantidad decimal', { ...goodSale, items: [{ ...goodSale.items[0], quantity: 1.5 }] }],
    ['precio negativo', { ...goodSale, items: [{ ...goodSale.items[0], unitPrice: -1 }] }],
    ['total ausente', { ...goodSale, items: [{ ...goodSale.items[0], total: undefined }] }],
    ['monto inválido', { ...goodSale, cashAmount: 'a' }],
  ])('400 y NO encola: %s', async (_n, body) => {
    const res = await handleOutboxRequest(post('/api/sales', body), 'SALE')
    expect(res!.status).toBe(400)
    expect((await res!.json()).success).toBe(false)
    expect(getOutboxStore(TENANT)!.counts().pending).toBe(0)
    expect(kick).not.toHaveBeenCalled()
  })

  it('JSON inválido y cuerpo que no es objeto → 400', async () => {
    expect((await handleOutboxRequest(post('/api/sales', '{no'), 'SALE'))!.status).toBe(400)
    expect((await handleOutboxRequest(post('/api/sales', '[1]'), 'SALE'))!.status).toBe(400)
  })

  it('cuerpo mayor a 1 MB → 413', async () => {
    const big = JSON.stringify({ pad: 'x'.repeat(MAX_BODY_BYTES + 1) })
    expect((await handleOutboxRequest(post('/api/sales', big), 'SALE'))!.status).toBe(413)
  })

  it('un userId que no es UUID se ignora', async () => {
    const res = await handleOutboxRequest(post('/api/sales', goodSale, token({ tenantId: TENANT, userId: '../x' })), 'SALE')
    const { clientId } = (await res!.json()).data
    expect(getOutboxStore(TENANT)!.getByClientId(clientId)!.sourceUserId).toBeNull()
  })
})

describe('gasto', () => {
  it('encola con la lista blanca de campos', async () => {
    const res = await handleOutboxRequest(
      post('/api/expenses', { description: ' Bolsas ', amount: 25.5, type: 'GENERAL', businessId: 'b1', productId: 3, extra: 'x' }),
      'EXPENSE',
    )
    expect(res!.status).toBe(201)
    const { clientId } = (await res!.json()).data
    const row = getOutboxStore(TENANT)!.getByClientId(clientId)!
    expect(row.type).toBe('EXPENSE')
    expect(JSON.parse(row.payload)).toEqual({ description: 'Bolsas', amount: 25.5, type: 'GENERAL', businessId: 'b1', productId: 3 })
  })

  it.each([
    ['sin descripción', { amount: 5 }],
    ['monto 0', { description: 'x', amount: 0 }],
    ['monto negativo', { description: 'x', amount: -1 }],
    ['monto ausente', { description: 'x' }],
  ])('400: %s', async (_n, body) => {
    expect((await handleOutboxRequest(post('/api/expenses', body), 'EXPENSE'))!.status).toBe(400)
  })
})

describe('degradación (devuelve null → proxy directo)', () => {
  it('sin Authorization', async () => {
    expect(await handleOutboxRequest(post('/api/sales', goodSale, null), 'SALE')).toBeNull()
  })
  it('token sin tenant', async () => {
    expect(await handleOutboxRequest(post('/api/sales', goodSale, token({ userId: USER })), 'SALE')).toBeNull()
  })
  it('sin OMERO_DATA_DIR (outbox no disponible)', async () => {
    vi.stubEnv('OMERO_DATA_DIR', '')
    vi.stubEnv('NODE_ENV', 'production')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await handleOutboxRequest(post('/api/sales', goodSale), 'SALE')).toBeNull()
  })
  it('falla de disco al encolar', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(getOutboxStore(TENANT)!, 'enqueue').mockImplementation(() => {
      throw new Error('disk full')
    })
    expect(await handleOutboxRequest(post('/api/sales', goodSale), 'SALE')).toBeNull()
    expect(kick).not.toHaveBeenCalled()
  })
  it('si el sender falla al iniciar, la venta igual queda encolada', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    kick.mockImplementationOnce(() => {
      throw new Error('x')
    })
    expect((await handleOutboxRequest(post('/api/sales', goodSale), 'SALE'))!.status).toBe(201)
    expect(getOutboxStore(TENANT)!.counts().pending).toBe(1)
  })
})

describe('handleApiRequest (data-layer)', () => {
  it('desktop: POST /api/sales se encola sin tocar el backend', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const res = await handleApiRequest(post('/api/sales', goodSale))
    expect(res.status).toBe(201)
    expect((await res.json()).data.queued).toBe(true)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('web: POST /api/sales va directo al backend (jamás encola)', async () => {
    vi.stubEnv('OMERO_RUNTIME', 'web')
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"success":true,"data":{"id":1}}', { status: 201, headers: { 'content-type': 'application/json' } }))
    const res = await handleApiRequest(post('/api/sales', goodSale))
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(String(fetchSpy.mock.calls[0][0])).toBe('http://127.0.0.1:9/api/sales')
    expect((await res.json()).data.id).toBe(1)
  })

  it('desktop con la venta inválida: 400 local, sin backend', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    expect((await handleApiRequest(post('/api/sales', { items: [] }))).status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('desktop sin outbox (sin token): cae al proxy directo', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"success":false,"error":"no auth"}', { status: 401, headers: { 'content-type': 'application/json' } }))
    const res = await handleApiRequest(post('/api/sales', goodSale, null))
    expect(res.status).toBe(401)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('otras rutas no cambian (GET /api/sales pasa al backend)', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"success":true,"data":[]}', { status: 200, headers: { 'content-type': 'application/json' } }))
    const res = await handleApiRequest(new Request('http://localhost:3000/api/sales', { headers: { authorization: token() } }))
    expect(res.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})
