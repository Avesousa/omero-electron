// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const kick = vi.fn()
const senderState = { backend: 'offline', nextAttemptAt: '2026-01-01T10:00:30.000Z', failures: 1 }
vi.mock('./outbox-sender', () => ({ getSender: () => ({ kick, state: () => senderState }) }))

import { GET as getConnectivity } from '../../app/api/%5Flocal/connectivity/route'
import { GET as getOutbox } from '../../app/api/%5Flocal/outbox/route'
import { POST as postImport } from '../../app/api/%5Flocal/outbox/import/route'
import { POST as postDismiss } from '../../app/api/%5Flocal/outbox/[clientId]/dismiss/route'
import { closeAllOutboxStores, getOutboxStore } from './outbox-registry'
import { closeAllCatalogStores } from '../catalog/store-registry'
import { legacyClientId } from './legacy-import'

const TENANT = '724c4579-ea83-4cef-9f37-bcfbfcc12268'
const OTHER = '11111111-2222-3333-4444-555555555555'
const token = (tenantId: string | null = TENANT) => {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
  return `Bearer ${b64({ alg: 'HS256' })}.${b64({ ...(tenantId ? { tenantId } : {}), userId: '99999999-aaaa-bbbb-cccc-000000000001', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`
}
const req = (url: string, init: RequestInit & { auth?: string | null } = {}) => {
  const { auth = token(), ...rest } = init
  return new Request(`http://localhost:3000${url}`, { ...rest, headers: { ...(auth ? { authorization: auth } : {}), 'content-type': 'application/json' } })
}
const sale = (code = '001', qty = 1) =>
  JSON.stringify({ items: [{ productId: code, productName: `P${code}`, quantity: qty, unitPrice: 10, total: 10 * qty }], cashAmount: 10, mpAmount: 0, change: 0 })

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omero-localapi-'))
  vi.stubEnv('OMERO_RUNTIME', 'desktop')
  vi.stubEnv('BACKEND_URL', 'http://127.0.0.1:9')
  vi.stubEnv('OMERO_DATA_DIR', dir)
  kick.mockClear()
})
afterEach(() => {
  closeAllOutboxStores()
  closeAllCatalogStores() // /api/_local/connectivity también abre la caché de catálogo
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('GET /api/_local/outbox', () => {
  it('lista con conteos, estado del sender y resumen SIN payload', async () => {
    const store = getOutboxStore(TENANT)!
    const a = store.enqueue({ type: 'SALE', payload: sale('001', 2) }).row
    store.enqueue({ type: 'EXPENSE', payload: JSON.stringify({ description: 'Bolsas', amount: 5 }) })
    const b = store.enqueue({ type: 'SALE', payload: sale('999') }).row
    store.markReview(b.clientId, { serverId: '7', sentAt: new Date().toISOString() }, JSON.stringify({ status: 'NEEDS_REVIEW', reasons: ['PRODUCT_NOT_FOUND'] }))

    const body = (await (await getOutbox(req('/api/_local/outbox'))).json()).data
    expect(body).toMatchObject({ available: true, backend: 'offline', nextAttemptAt: senderState.nextAttemptAt })
    expect(body.counts).toEqual({ pending: 2, sent: 0, review: 1, failed: 0 })
    expect(body.items).toHaveLength(3)
    const first = body.items.find((i: { clientId: string }) => i.clientId === a.clientId)
    expect(first.summary).toMatchObject({ total: 20, itemCount: 1, products: ['P001'] })
    expect(first).not.toHaveProperty('payload')
    const review = body.items.find((i: { clientId: string }) => i.clientId === b.clientId)
    expect(review.review).toEqual({ status: 'NEEDS_REVIEW', reasons: ['PRODUCT_NOT_FOUND'] })
    expect(body.items.find((i: { type: string }) => i.type === 'EXPENSE').summary).toEqual({ description: 'Bolsas', amount: 5 })
  })

  it('filtra por status y pagina', async () => {
    const store = getOutboxStore(TENANT)!
    for (let i = 0; i < 5; i++) store.enqueue({ type: 'SALE', payload: sale() })
    const sent = store.enqueue({ type: 'SALE', payload: sale() }).row
    store.markSent(sent.clientId, { serverId: '1', sentAt: new Date().toISOString() })

    const pending = (await (await getOutbox(req('/api/_local/outbox?status=pending&limit=2&offset=1'))).json()).data
    expect(pending.items).toHaveLength(2)
    expect(pending.items.every((i: { status: string }) => i.status === 'PENDING')).toBe(true)
    const onlySent = (await (await getOutbox(req('/api/_local/outbox?status=SENT'))).json()).data
    expect(onlySent.items).toHaveLength(1)
    const junk = (await (await getOutbox(req('/api/_local/outbox?status=BOGUS&limit=abc'))).json()).data
    expect(junk.items).toHaveLength(5) // status inválido → por defecto (sin SENT)
  })

  it('?detail= devuelve el payload; UUID inválido 400; inexistente 404', async () => {
    const a = getOutboxStore(TENANT)!.enqueue({ type: 'SALE', payload: sale('001', 3) }).row
    const ok = await getOutbox(req(`/api/_local/outbox?detail=${a.clientId}`))
    expect((await ok.json()).data.payload.items[0].quantity).toBe(3)
    expect((await getOutbox(req('/api/_local/outbox?detail=../x'))).status).toBe(400)
    expect((await getOutbox(req(`/api/_local/outbox?detail=${OTHER}`))).status).toBe(404)
  })

  it('aislamiento: otro tenant no ve ni accede a las filas', async () => {
    const a = getOutboxStore(TENANT)!.enqueue({ type: 'SALE', payload: sale() }).row
    const other = (await (await getOutbox(req('/api/_local/outbox', { auth: token(OTHER) }))).json()).data
    expect(other.counts.pending).toBe(0)
    expect((await getOutbox(req(`/api/_local/outbox?detail=${a.clientId}`, { auth: token(OTHER) }))).status).toBe(404)
  })

  it('sin token, en web o sin outbox → available:false vacío', async () => {
    const noAuth = (await (await getOutbox(req('/api/_local/outbox', { auth: null }))).json()).data
    expect(noAuth).toMatchObject({ available: false, items: [] })
    vi.stubEnv('OMERO_RUNTIME', 'web')
    expect((await (await getOutbox(req('/api/_local/outbox'))).json()).data.available).toBe(false)
  })
})

describe('POST /api/_local/outbox/import', () => {
  const legacy = (id: string, extra: Record<string, unknown> = {}) => ({
    id, tenantId: TENANT, queuedAt: '2026-01-05T10:00:00.000Z', payload: JSON.parse(sale('001', 2)), ...extra,
  })

  it('importa, confirma ids, es idempotente y dispara el envío', async () => {
    const send = () => postImport(req('/api/_local/outbox/import', { method: 'POST', body: JSON.stringify({ items: [legacy('q1'), legacy('q2', { tenantId: OTHER })] }) }))
    const r1 = (await (await send()).json()).data
    expect(r1).toMatchObject({ available: true, imported: ['q1'], ignored: ['q2'], rejected: [] })
    expect(kick).toHaveBeenCalledWith(TENANT)
    const r2 = (await (await send()).json()).data
    expect(r2.imported).toEqual(['q1'])
    expect(getOutboxStore(TENANT)!.counts().pending).toBe(1)
    expect(getOutboxStore(TENANT)!.getByClientId(legacyClientId(TENANT, 'q1'))!.createdAt).toBe('2026-01-05T10:00:00.000Z')
  })

  it('400 con JSON inválido o sin items; 413 si es enorme', async () => {
    expect((await postImport(req('/api/_local/outbox/import', { method: 'POST', body: '{no' }))).status).toBe(400)
    expect((await postImport(req('/api/_local/outbox/import', { method: 'POST', body: '{}' }))).status).toBe(400)
    const big = JSON.stringify({ items: [], pad: 'x'.repeat(5 * 1024 * 1024 + 1) })
    expect((await postImport(req('/api/_local/outbox/import', { method: 'POST', body: big }))).status).toBe(413)
  })

  it('sin token no importa nada y no falla', async () => {
    const r = await postImport(req('/api/_local/outbox/import', { method: 'POST', auth: null, body: JSON.stringify({ items: [legacy('z')] }) }))
    expect((await r.json()).data).toMatchObject({ available: false, imported: [] })
  })
})

describe('POST /api/_local/outbox/{clientId}/dismiss', () => {
  const call = (clientId: string, auth: string | null = token()) =>
    postDismiss(req(`/api/_local/outbox/${clientId}/dismiss`, { method: 'POST', auth }), { params: Promise.resolve({ clientId }) })

  it('descarta un FAILED (deja de contarse) y no otros estados', async () => {
    const store = getOutboxStore(TENANT)!
    const failed = store.enqueue({ type: 'SALE', payload: sale() }).row
    store.markFailed(failed.clientId, 'rechazada')
    const pending = store.enqueue({ type: 'SALE', payload: sale() }).row

    expect(store.counts().failed).toBe(1)
    expect((await call(failed.clientId)).status).toBe(200)
    expect(store.counts().failed).toBe(0)
    expect((await call(failed.clientId)).status).toBe(404) // ya descartado
    expect((await call(pending.clientId)).status).toBe(404) // no es FAILED
  })

  it('UUID inválido 400; otro tenant / sin token 404', async () => {
    const store = getOutboxStore(TENANT)!
    const f = store.enqueue({ type: 'SALE', payload: sale() }).row
    store.markFailed(f.clientId, 'x')
    expect((await call('nope')).status).toBe(400)
    expect((await call(f.clientId, token(OTHER))).status).toBe(404)
    expect((await call(f.clientId, null)).status).toBe(404)
    expect(store.counts().failed).toBe(1)
  })
})

describe('GET /api/_local/connectivity — campo outbox', () => {
  const stubHealth = (ok: boolean) =>
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: ok ? 200 : 503 }))

  it('desktop: suma pendientes/revisar/fallidas y el estado del envío', async () => {
    const store = getOutboxStore(TENANT)!
    store.enqueue({ type: 'SALE', payload: sale() })
    const f = store.enqueue({ type: 'SALE', payload: sale() }).row
    store.markFailed(f.clientId, 'x')
    stubHealth(false)
    const body = await (await getConnectivity(req('/api/_local/connectivity'))).json()
    expect(body.online).toBe(false)
    expect(body.outbox).toEqual({ pending: 1, review: 0, failed: 1, backend: 'offline', nextAttemptAt: senderState.nextAttemptAt })
  })

  it('web o sin token → outbox null', async () => {
    stubHealth(true)
    expect((await (await getConnectivity(req('/api/_local/connectivity', { auth: null }))).json()).outbox).toBeNull()
    vi.stubEnv('OMERO_RUNTIME', 'web')
    expect((await (await getConnectivity(req('/api/_local/connectivity'))).json()).outbox).toBeNull()
  })
})
