// @vitest-environment node
import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OutboxStore } from './outbox-store'
import { backoffDelayMs, BATCH_SIZE, OutboxSender } from './outbox-sender'

const TENANT = '724c4579-ea83-4cef-9f37-bcfbfcc12268'
const OTHER = '11111111-2222-3333-4444-555555555555'
const T0 = new Date('2026-01-01T10:00:00Z')

function jwt(tenantId = TENANT, exp = Math.floor(T0.getTime() / 1000) + 3600): string {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
  return `Bearer ${b64({ alg: 'HS256' })}.${b64({ tenantId, exp })}.sig`
}

const saleJson = (code = '001') =>
  JSON.stringify({ items: [{ productId: code, productName: 'X', quantity: 1, unitPrice: 10, total: 10 }], cashAmount: 10, mpAmount: 0, change: 0 })
const expenseJson = () => JSON.stringify({ description: 'Bolsas', amount: 5, type: 'GENERAL', businessId: null })

const ok = (results: unknown[]) =>
  new Response(JSON.stringify({ success: true, data: { results } }), { status: 200, headers: { 'content-type': 'application/json' } })
const status = (code: number) => new Response('{}', { status: code })
const created = (clientId: string, entityId = '1', review?: unknown) => ({ clientId, status: 'CREATED', entityId, ...(review ? { review } : {}) })

let dir: string
let store: OutboxStore
let fetchFn: ReturnType<typeof vi.fn>
let auth: string | null
let forget: ReturnType<typeof vi.fn>
let invalidate: ReturnType<typeof vi.fn>
let sender: OutboxSender

const flush = async () => {
  await vi.advanceTimersByTimeAsync(0)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omero-sender-test-'))
  store = OutboxStore.open({ dataDir: dir, tenantId: TENANT, Database, log: vi.fn() })
  fetchFn = vi.fn()
  auth = jwt()
  invalidate = vi.fn()
  forget = vi.fn(() => {
    auth = null
  })
  sender = new OutboxSender({
    fetchFn: fetchFn as unknown as typeof fetch,
    getStore: (t) => (t === TENANT ? store : null),
    getAuthorization: () => auth,
    invalidateAuthorization: invalidate as unknown as (t: string) => void,
    forgetAuthorization: forget as unknown as (t: string) => void,
    backendUrl: () => 'https://backend.test',
    now: () => Date.now(),
    log: vi.fn(),
  })
})
afterEach(() => {
  sender.stop()
  store.close()
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  vi.useRealTimers()
})

describe('backoffDelayMs', () => {
  it('30 s → 90 s → 270 s → 810 s y luego 810 s', () => {
    expect([1, 2, 3, 4, 5, 9].map(backoffDelayMs)).toEqual([30_000, 90_000, 270_000, 810_000, 810_000, 810_000])
  })
})

describe('envío exitoso', () => {
  it('sube ventas y gastos, del más viejo al más nuevo, sin costo y con productName', async () => {
    const a = store.enqueue({ type: 'SALE', payload: saleJson('001'), sourceUserId: 'u1' }).row
    const b = store.enqueue({ type: 'EXPENSE', payload: expenseJson() }).row
    fetchFn.mockResolvedValueOnce(ok([created(a.clientId, '10'), created(b.clientId, 'e-1')]))

    sender.kick(TENANT)
    await flush()

    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe('https://backend.test/api/sync/batch')
    expect(init.headers.Authorization).toBe(auth ?? jwt())
    const body = JSON.parse(init.body)
    expect(body.items.map((i: { clientId: string }) => i.clientId)).toEqual([a.clientId, b.clientId])
    expect(body.items[0]).toMatchObject({ type: 'SALE', sourceUserId: 'u1', createdAt: a.createdAt })
    expect(body.items[0].sale.items[0].productName).toBe('X')
    expect(JSON.stringify(body)).not.toMatch(/cost/i)
    expect(body.items[1].expense.description).toBe('Bolsas')

    expect(store.getByClientId(a.clientId)).toMatchObject({ status: 'SENT', serverId: '10', attempts: 1 })
    expect(store.getByClientId(b.clientId)?.status).toBe('SENT')
    expect(sender.state(TENANT)).toMatchObject({ backend: 'ok', failures: 0, nextAttemptAt: null })
  })

  it('un DUPLICATE cuenta como enviado', async () => {
    const a = store.enqueue({ type: 'SALE', payload: saleJson() }).row
    fetchFn.mockResolvedValueOnce(ok([{ clientId: a.clientId, status: 'DUPLICATE', entityId: '7' }]))
    sender.kick(TENANT)
    await flush()
    expect(store.getByClientId(a.clientId)).toMatchObject({ status: 'SENT', serverId: '7' })
  })

  it('una venta marcada para revisión queda REVIEW con el detalle', async () => {
    const a = store.enqueue({ type: 'SALE', payload: saleJson('999') }).row
    const review = { status: 'NEEDS_REVIEW', reasons: ['PRODUCT_NOT_FOUND'], items: [{ productCode: '999', problem: 'PRODUCT_NOT_FOUND' }] }
    fetchFn.mockResolvedValueOnce(ok([created(a.clientId, '3', review)]))
    sender.kick(TENANT)
    await flush()
    const row = store.getByClientId(a.clientId)!
    expect(row.status).toBe('REVIEW')
    expect(JSON.parse(row.reviewJson!)).toEqual(review)
  })

  it('un ítem rechazado (VALIDATION) queda FAILED y no frena a los demás', async () => {
    const bad = store.enqueue({ type: 'SALE', payload: saleJson() }).row
    const good = store.enqueue({ type: 'SALE', payload: saleJson() }).row
    fetchFn.mockResolvedValueOnce(
      ok([{ clientId: bad.clientId, status: 'REJECTED', error: { code: 'VALIDATION', message: 'Cantidad inválida' } }, created(good.clientId)]),
    )
    sender.kick(TENANT)
    await flush()
    expect(store.getByClientId(bad.clientId)).toMatchObject({ status: 'FAILED', error: 'Cantidad inválida' })
    expect(store.getByClientId(good.clientId)?.status).toBe('SENT')
    expect(fetchFn).toHaveBeenCalledTimes(1) // nada pendiente → no reintenta
  })

  it('con más de 50 pendientes envía en lotes consecutivos sin esperar', async () => {
    const rows = Array.from({ length: BATCH_SIZE + 5 }, () => store.enqueue({ type: 'SALE', payload: saleJson() }).row)
    fetchFn.mockImplementation(async (_u: string, init: { body: string }) =>
      ok(JSON.parse(init.body).items.map((i: { clientId: string }) => created(i.clientId))),
    )
    sender.kick(TENANT)
    await flush()
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetchFn.mock.calls[0][1].body).items).toHaveLength(BATCH_SIZE)
    expect(store.counts().pending).toBe(0)
    expect(rows.every((r) => store.getByClientId(r.clientId)?.status === 'SENT')).toBe(true)
  })

  it('un payload ilegible se marca FAILED y el resto se envía', async () => {
    const broken = store.enqueue({ type: 'SALE', payload: '{no-json' }).row
    const good = store.enqueue({ type: 'SALE', payload: saleJson() }).row
    fetchFn.mockResolvedValueOnce(ok([created(good.clientId)]))
    sender.kick(TENANT)
    await flush()
    expect(store.getByClientId(broken.clientId)?.status).toBe('FAILED')
    expect(store.getByClientId(good.clientId)?.status).toBe('SENT')
  })

  it('sin pendientes no llama al backend', async () => {
    sender.kick(TENANT)
    await flush()
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('reintentos con backoff', () => {
  it('30 s → 90 s → 270 s → 810 s → 810 s; luego éxito reinicia', async () => {
    const a = store.enqueue({ type: 'SALE', payload: saleJson() }).row
    fetchFn.mockRejectedValue(new TypeError('fetch failed'))

    sender.kick(TENANT)
    await flush()
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(sender.state(TENANT)).toMatchObject({ backend: 'offline', failures: 1 })
    expect(sender.state(TENANT).nextAttemptAt).toBe(new Date(T0.getTime() + 30_000).toISOString())

    let calls = 1
    for (const wait of [30_000, 90_000, 270_000, 810_000, 810_000]) {
      await vi.advanceTimersByTimeAsync(wait - 1)
      expect(fetchFn).toHaveBeenCalledTimes(calls) // todavía no
      await vi.advanceTimersByTimeAsync(1)
      calls++
      expect(fetchFn).toHaveBeenCalledTimes(calls)
    }
    expect(store.getByClientId(a.clientId)).toMatchObject({ status: 'PENDING', attempts: 6 })

    fetchFn.mockResolvedValueOnce(ok([created(a.clientId)]))
    await vi.advanceTimersByTimeAsync(810_000)
    expect(store.getByClientId(a.clientId)?.status).toBe('SENT')
    expect(sender.state(TENANT)).toMatchObject({ backend: 'ok', failures: 0, nextAttemptAt: null })
  })

  it.each([[500], [502], [400]])('HTTP %i es fallo de transporte: reintenta', async (code) => {
    const a = store.enqueue({ type: 'SALE', payload: saleJson() }).row
    fetchFn.mockResolvedValueOnce(status(code))
    sender.kick(TENANT)
    await flush()
    expect(store.getByClientId(a.clientId)?.status).toBe('PENDING')
    expect(sender.state(TENANT).failures).toBe(1)
  })

  it('respuesta con cuerpo inválido es fallo de transporte', async () => {
    store.enqueue({ type: 'SALE', payload: saleJson() })
    fetchFn.mockResolvedValueOnce(new Response('<html>', { status: 200 }))
    sender.kick(TENANT)
    await flush()
    expect(sender.state(TENANT)).toMatchObject({ backend: 'offline', failures: 1 })
  })

  it('INTERNAL_ERROR de un ítem: sigue PENDING y se reintenta; los demás se resuelven', async () => {
    const flaky = store.enqueue({ type: 'SALE', payload: saleJson() }).row
    const good = store.enqueue({ type: 'SALE', payload: saleJson() }).row
    fetchFn.mockResolvedValueOnce(
      ok([{ clientId: flaky.clientId, status: 'REJECTED', error: { code: 'INTERNAL_ERROR', message: 'boom' } }, created(good.clientId)]),
    )
    sender.kick(TENANT)
    await flush()
    expect(store.getByClientId(flaky.clientId)?.status).toBe('PENDING')
    expect(store.getByClientId(good.clientId)?.status).toBe('SENT')
    // hubo avance (la cuenta se reinicia) pero queda un ítem con error del servidor: primer escalón del backoff
    expect(sender.state(TENANT).failures).toBe(1)
    expect(sender.state(TENANT).nextAttemptAt).toBe(new Date(T0.getTime() + 30_000).toISOString())
  })

  it('404 → backend "unsupported" (sigue reintentando con backoff)', async () => {
    store.enqueue({ type: 'SALE', payload: saleJson() })
    fetchFn.mockResolvedValueOnce(status(404))
    sender.kick(TENANT)
    await flush()
    expect(sender.state(TENANT)).toMatchObject({ backend: 'unsupported', failures: 1 })
    expect(sender.state(TENANT).nextAttemptAt).not.toBeNull()
  })

  it('una venta nueva durante el backoff NO se envía antes de tiempo', async () => {
    store.enqueue({ type: 'SALE', payload: saleJson() })
    fetchFn.mockRejectedValue(new TypeError('down'))
    sender.kick(TENANT)
    await flush()
    store.enqueue({ type: 'SALE', payload: saleJson() })
    sender.kick(TENANT)
    await flush()
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('kick con force (conexión recuperada) cancela el backoff y reintenta ya', async () => {
    const a = store.enqueue({ type: 'SALE', payload: saleJson() }).row
    fetchFn.mockRejectedValueOnce(new TypeError('down'))
    sender.kick(TENANT)
    await flush()
    fetchFn.mockResolvedValueOnce(ok([created(a.clientId)]))
    sender.handleSyncerEvent({ type: 'online' })
    await flush()
    expect(store.getByClientId(a.clientId)?.status).toBe('SENT')
    expect(sender.state(TENANT).failures).toBe(0)
  })

  it('"volvió la conexión" mientras el envío en curso falla: reintenta ya, sin esperar el backoff de 30 s', async () => {
    const a = store.enqueue({ type: 'SALE', payload: saleJson() }).row
    let fail!: () => void
    fetchFn.mockImplementationOnce(() => new Promise<Response>((_r, rej) => (fail = () => rej(new TypeError('down')))))
    sender.kick(TENANT)
    await flush()
    sender.handleSyncerEvent({ type: 'online' }) // llega con el envío todavía en vuelo
    fetchFn.mockResolvedValueOnce(ok([created(a.clientId)]))
    fail()
    await flush()
    expect(store.getByClientId(a.clientId)?.status).toBe('SENT')
    expect(sender.state(TENANT)).toMatchObject({ backend: 'ok', failures: 0, nextAttemptAt: null })
  })

  it('sin red para renovar el token (authorize unavailable) es un fallo de transporte con backoff, no "unauthorized"', async () => {
    store.enqueue({ type: 'SALE', payload: saleJson() })
    const s2 = new OutboxSender({
      fetchFn: fetchFn as unknown as typeof fetch, getStore: () => store, authorize: async () => ({ ok: false, reason: 'unavailable' }),
      backendUrl: () => 'https://backend.test', now: () => Date.now(), log: vi.fn(),
    })
    s2.kick(TENANT)
    await flush()
    expect(s2.state(TENANT)).toMatchObject({ backend: 'offline', failures: 1 })
    expect(fetchFn).not.toHaveBeenCalled()
    s2.stop()
  })

  it('con el token de solo subida (kind sync) envía normalmente', async () => {
    const a = store.enqueue({ type: 'SALE', payload: saleJson() }).row
    const s2 = new OutboxSender({
      fetchFn: fetchFn as unknown as typeof fetch, getStore: () => store,
      authorize: async () => ({ ok: true, authorization: jwt(), kind: 'sync' }),
      backendUrl: () => 'https://backend.test', now: () => Date.now(), log: vi.fn(),
    })
    fetchFn.mockResolvedValueOnce(ok([created(a.clientId)]))
    s2.kick(TENANT)
    await flush()
    expect(store.getByClientId(a.clientId)?.status).toBe('SENT')
    s2.stop()
  })

  it('un solo lote a la vez por tenant', async () => {
    store.enqueue({ type: 'SALE', payload: saleJson() })
    let release!: () => void
    fetchFn.mockImplementationOnce(() => new Promise<Response>((r) => (release = () => r(status(500)))))
    sender.kick(TENANT)
    sender.kick(TENANT)
    sender.kick(TENANT)
    await flush()
    expect(fetchFn).toHaveBeenCalledTimes(1)
    release()
    await flush()
  })
})

describe('autenticación', () => {
  it('401 → renueva y reintenta UNA vez; si vuelve el 401 → detiene, olvida el token y deja lo pendiente intacto', async () => {
    const a = store.enqueue({ type: 'SALE', payload: saleJson() }).row
    fetchFn.mockResolvedValue(status(401))
    sender.kick(TENANT)
    await flush()
    expect(fetchFn).toHaveBeenCalledTimes(2) // el intento y UN reintento tras invalidar
    expect(invalidate).toHaveBeenCalledWith(TENANT)
    expect(forget).toHaveBeenCalledWith(TENANT)
    expect(sender.state(TENANT)).toMatchObject({ backend: 'unauthorized', nextAttemptAt: null })
    expect(store.getByClientId(a.clientId)?.status).toBe('PENDING')
    await vi.advanceTimersByTimeAsync(3_600_000)
    expect(fetchFn).toHaveBeenCalledTimes(2) // no reintenta solo
  })

  it('un 401 por token vencido se resuelve renovando: el reintento sube la venta', async () => {
    const a = store.enqueue({ type: 'SALE', payload: saleJson() }).row
    fetchFn.mockResolvedValueOnce(status(401)).mockResolvedValueOnce(ok([created(a.clientId)]))
    sender.kick(TENANT)
    await flush()
    expect(store.getByClientId(a.clientId)?.status).toBe('SENT')
    expect(forget).not.toHaveBeenCalled()
    expect(sender.state(TENANT).backend).toBe('ok')
  })

  it('el reintento por 401 se rehabilita tras un éxito (otro vencimiento más adelante también se renueva)', async () => {
    const a = store.enqueue({ type: 'SALE', payload: saleJson() }).row
    fetchFn.mockResolvedValueOnce(status(401)).mockResolvedValueOnce(ok([created(a.clientId)]))
    sender.kick(TENANT)
    await flush()
    const b = store.enqueue({ type: 'SALE', payload: saleJson() }).row
    fetchFn.mockResolvedValueOnce(status(401)).mockResolvedValueOnce(ok([created(b.clientId)]))
    sender.kick(TENANT)
    await flush()
    expect(store.getByClientId(b.clientId)?.status).toBe('SENT')
  })

  it('403 también', async () => {
    store.enqueue({ type: 'SALE', payload: saleJson() })
    fetchFn.mockResolvedValue(status(403))
    sender.kick(TENANT)
    await flush()
    expect(sender.state(TENANT).backend).toBe('unauthorized')
  })

  it('sin token no envía y queda "unauthorized"; con un token nuevo reanuda', async () => {
    const a = store.enqueue({ type: 'SALE', payload: saleJson() }).row
    auth = null
    sender.kick(TENANT)
    await flush()
    expect(fetchFn).not.toHaveBeenCalled()
    expect(sender.state(TENANT).backend).toBe('unauthorized')

    auth = jwt()
    fetchFn.mockResolvedValueOnce(ok([created(a.clientId)]))
    sender.handleSyncerEvent({ type: 'authorization', tenantId: TENANT })
    await flush()
    expect(store.getByClientId(a.clientId)?.status).toBe('SENT')
    expect(sender.state(TENANT).backend).toBe('ok')
  })

  it('un token de OTRO tenant nunca se usa para este outbox', async () => {
    store.enqueue({ type: 'SALE', payload: saleJson() })
    auth = jwt(OTHER)
    sender.kick(TENANT)
    await flush()
    expect(fetchFn).not.toHaveBeenCalled()
    expect(sender.state(TENANT).backend).toBe('unauthorized')
  })

  it('un token vencido no se usa', async () => {
    store.enqueue({ type: 'SALE', payload: saleJson() })
    auth = jwt(TENANT, Math.floor(T0.getTime() / 1000) - 10)
    sender.kick(TENANT)
    await flush()
    expect(fetchFn).not.toHaveBeenCalled()
    expect(sender.state(TENANT).backend).toBe('unauthorized')
  })

  it('tras un reinicio (cola sin crear) un token nuevo dispara el envío de lo pendiente', async () => {
    const a = store.enqueue({ type: 'SALE', payload: saleJson() }).row
    fetchFn.mockResolvedValueOnce(ok([created(a.clientId)]))
    sender.handleSyncerEvent({ type: 'authorization', tenantId: TENANT })
    await flush()
    expect(store.getByClientId(a.clientId)?.status).toBe('SENT')
  })
})

describe('413 y otros bordes', () => {
  it('413 parte el lote a la mitad y reintenta de inmediato', async () => {
    const rows = Array.from({ length: 4 }, () => store.enqueue({ type: 'SALE', payload: saleJson() }).row)
    fetchFn.mockResolvedValueOnce(status(413))
    fetchFn.mockImplementation(async (_u: string, init: { body: string }) =>
      ok(JSON.parse(init.body).items.map((i: { clientId: string }) => created(i.clientId))),
    )
    sender.kick(TENANT)
    await flush()
    expect(JSON.parse(fetchFn.mock.calls[1][1].body).items).toHaveLength(4)
    expect(rows.every((r) => store.getByClientId(r.clientId)?.status === 'SENT')).toBe(true)
  })

  it('el ítem que el backend no informa sigue PENDING y se reintenta', async () => {
    const a = store.enqueue({ type: 'SALE', payload: saleJson() }).row
    fetchFn.mockResolvedValueOnce(ok([]))
    sender.kick(TENANT)
    await flush()
    expect(store.getByClientId(a.clientId)?.status).toBe('PENDING')
    expect(sender.state(TENANT).failures).toBe(1)
  })

  it('sin store del tenant (outbox no disponible) no hace nada', async () => {
    sender.kick(OTHER)
    await flush()
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('un error inesperado programa reintento en lugar de romper', async () => {
    store.enqueue({ type: 'SALE', payload: saleJson() })
    fetchFn.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.reject(new Error('x')) })
    sender.kick(TENANT)
    await flush()
    expect(sender.state(TENANT).failures).toBe(1)
  })

  it('purga periódica cuando la cola queda vacía', async () => {
    const spy = vi.spyOn(store, 'purge')
    sender.kick(TENANT)
    await flush()
    sender.kick(TENANT)
    await flush()
    expect(spy).toHaveBeenCalledTimes(1) // limitada a una vez por hora
    await vi.advanceTimersByTimeAsync(3_600_001)
    sender.kick(TENANT)
    await flush()
    expect(spy).toHaveBeenCalledTimes(2)
  })
})
