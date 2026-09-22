// @vitest-environment node
import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LATEST_OUTBOX_SCHEMA_VERSION, OUTBOX_MIGRATIONS } from './outbox-migrations'
import { DISMISSED_RETENTION_MS, OutboxStore, resolveOutboxPath, SENT_RETENTION_MS } from './outbox-store'

const TENANT = '724c4579-ea83-4cef-9f37-bcfbfcc12268'
const OTHER = '11111111-2222-3333-4444-555555555555'

let dir: string
let stores: OutboxStore[]
let log: ReturnType<typeof vi.fn>

const open = (tenantId = TENANT) => {
  const s = OutboxStore.open({ dataDir: dir, tenantId, Database, log })
  stores.push(s)
  return s
}
const sale = (items: { productId: string; quantity: number }[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ items: items.map((i) => ({ ...i, unitPrice: 100, total: 100 * i.quantity })), cashAmount: 0, mpAmount: 0, change: 0, ...extra })

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omero-outbox-test-'))
  stores = []
  log = vi.fn()
})
afterEach(() => {
  for (const s of stores) s.close()
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('ruta y seguridad', () => {
  it('arma <dataDir>/<uuid>.outbox.sqlite en minúsculas (archivo distinto de la caché)', () => {
    expect(resolveOutboxPath(dir, TENANT.toUpperCase())).toBe(path.join(dir, `${TENANT}.outbox.sqlite`))
  })

  it.each(['../evil', 'no-uuid', '', `${TENANT}/../x`])('rechaza tenantId inválido: %j', (bad) => {
    expect(() => resolveOutboxPath(dir, bad)).toThrow(/tenantId inválido/)
  })
})

describe('apertura y durabilidad', () => {
  it('crea la base con esquema al día, WAL y synchronous=FULL (durable)', () => {
    open()
    const file = path.join(dir, `${TENANT}.outbox.sqlite`)
    const raw = new Database(file)
    expect(raw.pragma('user_version', { simple: true })).toBe(LATEST_OUTBOX_SCHEMA_VERSION)
    expect(raw.pragma('journal_mode', { simple: true })).toBe('wal')
    raw.close()
    // synchronous es por conexión: se verifica sobre la del store
    const store = stores[0] as unknown as { conn: InstanceType<typeof Database> }
    expect(store.conn.pragma('synchronous', { simple: true })).toBe(2) // 2 = FULL
  })

  it('migraciones consecutivas desde 1', () => {
    OUTBOX_MIGRATIONS.forEach((m, i) => expect(m.version).toBe(i + 1))
  })

  it('lo encolado sobrevive a cerrar y reabrir (persistencia)', () => {
    const a = open()
    a.enqueue({ type: 'SALE', payload: sale([{ productId: '001', quantity: 1 }]) })
    a.close()
    const b = open()
    expect(b.counts().pending).toBe(1)
  })

  it('un outbox corrupto NO se borra: se aparta y se crea uno nuevo', () => {
    const file = path.join(dir, `${TENANT}.outbox.sqlite`)
    fs.writeFileSync(file, Buffer.from('esto no es sqlite '.repeat(300)))
    const s = open()
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/se apartó en .*\.corrupt-/))
    const moved = fs.readdirSync(dir).filter((f) => f.includes('.corrupt-'))
    expect(moved).toHaveLength(1)
    expect(fs.readFileSync(path.join(dir, moved[0])).toString()).toContain('esto no es sqlite') // contenido intacto
    expect(s.counts()).toEqual({ pending: 0, sent: 0, review: 0, failed: 0 })
  })

  it('un esquema más nuevo también se aparta (no se pisa)', () => {
    const file = path.join(dir, `${TENANT}.outbox.sqlite`)
    const future = new Database(file)
    future.exec('CREATE TABLE futuro (x)')
    future.pragma(`user_version = ${LATEST_OUTBOX_SCHEMA_VERSION + 3}`)
    future.close()
    open()
    expect(fs.readdirSync(dir).some((f) => f.includes('.corrupt-'))).toBe(true)
  })

  it('un binding inexistente es un error real (no se confunde con corrupción)', () => {
    expect(() =>
      OutboxStore.open({ dataDir: dir, tenantId: TENANT, Database, nativeBinding: path.join(dir, 'no-existe.node') }),
    ).toThrow()
  })

  it('cada tenant tiene su archivo', () => {
    const a = open(TENANT)
    const b = open(OTHER)
    a.enqueue({ type: 'SALE', payload: sale([{ productId: '001', quantity: 1 }]) })
    expect(b.counts().pending).toBe(0)
    expect(fs.existsSync(path.join(dir, `${OTHER}.outbox.sqlite`))).toBe(true)
  })

  it('operar un outbox cerrado lanza; close() es idempotente', () => {
    const s = open()
    s.close()
    expect(() => s.close()).not.toThrow()
    expect(() => s.counts()).toThrow(/cerrado/)
  })
})

describe('enqueue', () => {
  it('genera clientId UUID, estado PENDING y conserva payload, tipo y fecha de la caja', () => {
    const s = open()
    const payload = sale([{ productId: '001', quantity: 2 }])
    const { row, inserted } = s.enqueue({ type: 'SALE', payload, createdAt: '2026-01-01T10:00:00.000Z', sourceUserId: 'u-1' })
    expect(inserted).toBe(true)
    expect(row.clientId).toMatch(/^[0-9a-f-]{36}$/)
    expect(row).toMatchObject({
      type: 'SALE', payload, createdAt: '2026-01-01T10:00:00.000Z', sourceUserId: 'u-1',
      status: 'PENDING', attempts: 0, serverId: null, sentAt: null, error: null,
    })
  })

  it('createdAt por defecto es ahora (ISO UTC)', () => {
    const s = open()
    const { row } = s.enqueue({ type: 'EXPENSE', payload: '{}' })
    expect(Math.abs(Date.now() - Date.parse(row.createdAt))).toBeLessThan(2000)
  })

  it('clientId fijo (importación): idempotente, no duplica y devuelve la fila existente', () => {
    const s = open()
    const first = s.enqueue({ type: 'SALE', payload: '{"a":1}', clientId: 'legacy-abc' })
    const second = s.enqueue({ type: 'SALE', payload: '{"a":2}', clientId: 'legacy-abc' })
    expect(first.inserted).toBe(true)
    expect(second.inserted).toBe(false)
    expect(second.row.payload).toBe('{"a":1}') // no se pisa
    expect(s.counts().pending).toBe(1)
  })

  it('rechaza un tipo desconocido (CHECK)', () => {
    const s = open()
    expect(() => s.enqueue({ type: 'OTRO' as never, payload: '{}' })).toThrow()
  })
})

describe('orden y lotes', () => {
  it('nextBatch devuelve PENDING del más viejo al más nuevo y respeta el límite', () => {
    const s = open()
    const ids = [1, 2, 3, 4].map((n) => s.enqueue({ type: 'SALE', payload: `{"n":${n}}` }).row.clientId)
    expect(s.nextBatch(3).map((r) => r.clientId)).toEqual(ids.slice(0, 3))
    s.markSent(ids[0], { serverId: '1', sentAt: new Date().toISOString() })
    expect(s.nextBatch(10).map((r) => r.clientId)).toEqual(ids.slice(1)) // los SENT no vuelven a salir
  })

  it('markAttempt cuenta intentos y fecha del último', () => {
    const s = open()
    const { row } = s.enqueue({ type: 'SALE', payload: '{}' })
    s.markAttempt([row.clientId], new Date('2026-01-01T10:00:00Z'))
    s.markAttempt([row.clientId], new Date('2026-01-01T10:00:30Z'))
    expect(s.getByClientId(row.clientId)).toMatchObject({ attempts: 2, lastAttemptAt: '2026-01-01T10:00:30.000Z' })
  })
})

describe('transiciones de estado', () => {
  it('PENDING → SENT guarda id del servidor y fecha; es idempotente (no retrocede ni se pisa)', () => {
    const s = open()
    const { row } = s.enqueue({ type: 'SALE', payload: '{}' })
    expect(s.markSent(row.clientId, { serverId: '77', sentAt: '2026-01-01T10:00:00.000Z' })).toBe(true)
    expect(s.markSent(row.clientId, { serverId: '99', sentAt: '2026-02-02T10:00:00.000Z' })).toBe(false)
    expect(s.getByClientId(row.clientId)).toMatchObject({ status: 'SENT', serverId: '77', sentAt: '2026-01-01T10:00:00.000Z' })
  })

  it('PENDING → REVIEW guarda el detalle devuelto por el backend', () => {
    const s = open()
    const { row } = s.enqueue({ type: 'SALE', payload: '{}' })
    const review = JSON.stringify({ reasons: ['PRODUCT_NOT_FOUND'] })
    expect(s.markReview(row.clientId, { serverId: '5', sentAt: '2026-01-01T10:00:00.000Z' }, review)).toBe(true)
    expect(s.getByClientId(row.clientId)).toMatchObject({ status: 'REVIEW', serverId: '5', reviewJson: review })
  })

  it('PENDING → FAILED conserva el dato y guarda el motivo; un FAILED no vuelve a enviarse', () => {
    const s = open()
    const { row } = s.enqueue({ type: 'SALE', payload: '{"keep":true}' })
    expect(s.markFailed(row.clientId, 'La venta no tiene ítems')).toBe(true)
    expect(s.getByClientId(row.clientId)).toMatchObject({ status: 'FAILED', error: 'La venta no tiene ítems', payload: '{"keep":true}' })
    expect(s.nextBatch(10)).toEqual([])
  })

  it('solo se transiciona desde PENDING', () => {
    const s = open()
    const { row } = s.enqueue({ type: 'SALE', payload: '{}' })
    s.markFailed(row.clientId, 'x')
    expect(s.markSent(row.clientId, { serverId: '1', sentAt: 'x' })).toBe(false)
    expect(s.markReview(row.clientId, { serverId: '1', sentAt: 'x' }, '{}')).toBe(false)
    expect(s.markFailed(row.clientId, 'y')).toBe(false)
  })

  it('dismiss solo aplica a FAILED y deja de contarse', () => {
    const s = open()
    const a = s.enqueue({ type: 'SALE', payload: '{}' }).row
    const b = s.enqueue({ type: 'SALE', payload: '{}' }).row
    s.markFailed(a.clientId, 'x')
    expect(s.counts().failed).toBe(1)
    expect(s.dismiss(b.clientId)).toBe(false) // PENDING: no
    expect(s.dismiss(a.clientId)).toBe(true)
    expect(s.dismiss(a.clientId)).toBe(false) // ya descartado
    expect(s.counts().failed).toBe(0)
    expect(s.list({ statuses: ['FAILED'] })).toEqual([])
    expect(s.list({ statuses: ['FAILED'], includeDismissed: true })).toHaveLength(1)
  })
})

describe('counts y list', () => {
  it('cuenta por estado', () => {
    const s = open()
    const r = [1, 2, 3, 4].map(() => s.enqueue({ type: 'SALE', payload: '{}' }).row.clientId)
    s.markSent(r[0], { serverId: '1', sentAt: 'x' })
    s.markReview(r[1], { serverId: '2', sentAt: 'x' }, '{}')
    s.markFailed(r[2], 'e')
    expect(s.counts()).toEqual({ pending: 1, sent: 1, review: 1, failed: 1 })
  })

  it('list: más nuevo primero, filtra por estado y pagina; limita el máximo', () => {
    const s = open()
    for (let i = 0; i < 5; i++) s.enqueue({ type: 'SALE', payload: `{"i":${i}}` })
    expect(s.list().map((r) => JSON.parse(r.payload).i)).toEqual([4, 3, 2, 1, 0])
    expect(s.list({ limit: 2, offset: 1 }).map((r) => JSON.parse(r.payload).i)).toEqual([3, 2])
    expect(s.list({ statuses: ['SENT'] })).toEqual([])
    expect(s.list({ limit: 9999 }).length).toBe(5)
  })
})

describe('activeSaleQuantities (stock mostrado = backend − pendientes)', () => {
  const at = (iso: string) => ({ serverId: '1', sentAt: iso })

  it('suma los PENDING por código; ignora gastos, el código 000 y cantidades inválidas', () => {
    const s = open()
    s.enqueue({ type: 'SALE', payload: sale([{ productId: '001', quantity: 2 }, { productId: '000', quantity: 3 }]) })
    s.enqueue({ type: 'SALE', payload: sale([{ productId: '001', quantity: 1 }, { productId: '002', quantity: 5 }]) })
    s.enqueue({ type: 'EXPENSE', payload: '{"items":[{"productId":"001","quantity":99}]}' })
    s.enqueue({ type: 'SALE', payload: sale([{ productId: '003', quantity: -1 }, { productId: '004', quantity: 0 }]) })
    s.enqueue({ type: 'SALE', payload: 'no es json' })
    expect(Object.fromEntries(s.activeSaleQuantities())).toEqual({ '001': 3, '002': 5 })
  })

  it('respuesta EN VIVO (sin since): solo PENDING; el backend ya incluye lo enviado', () => {
    const s = open()
    const sent = s.enqueue({ type: 'SALE', payload: sale([{ productId: '001', quantity: 4 }]) }).row
    s.markSent(sent.clientId, at('2026-01-01T10:00:00.000Z'))
    s.enqueue({ type: 'SALE', payload: sale([{ productId: '001', quantity: 1 }]) })
    expect(s.activeSaleQuantities().get('001')).toBe(1)
  })

  it('desde CACHÉ (since): suma también lo enviado DESPUÉS del snapshot (con margen de 2 s)', () => {
    const s = open()
    const before = s.enqueue({ type: 'SALE', payload: sale([{ productId: '001', quantity: 10 }]) }).row
    const after = s.enqueue({ type: 'SALE', payload: sale([{ productId: '001', quantity: 4 }]) }).row
    const review = s.enqueue({ type: 'SALE', payload: sale([{ productId: '001', quantity: 2 }]) }).row
    s.markSent(before.clientId, at('2026-01-01T10:00:00.000Z')) // antes del snapshot → ya reflejado
    s.markSent(after.clientId, at('2026-01-01T10:05:00.000Z')) // después → aún no
    s.markReview(review.clientId, at('2026-01-01T10:05:01.000Z'), '{}')
    const since = '2026-01-01T10:02:00.000Z'
    expect(s.activeSaleQuantities({ since }).get('001')).toBe(4 + 2)
    // dentro del margen de 2 s (10:01:59 vs snapshot 10:02:00) se sigue contando: mejor restar de más que de menos
    const near = s.enqueue({ type: 'SALE', payload: sale([{ productId: '002', quantity: 7 }]) }).row
    s.markSent(near.clientId, at('2026-01-01T10:01:59.000Z'))
    expect(s.activeSaleQuantities({ since }).get('002')).toBe(7)
  })

  it('since null (caché sin fecha): cuenta todo lo enviado', () => {
    const s = open()
    const r = s.enqueue({ type: 'SALE', payload: sale([{ productId: '001', quantity: 3 }]) }).row
    s.markSent(r.clientId, at('2026-01-01T10:00:00.000Z'))
    expect(s.activeSaleQuantities({ since: null }).get('001')).toBe(3)
  })

  it('los FAILED no restan stock', () => {
    const s = open()
    const r = s.enqueue({ type: 'SALE', payload: sale([{ productId: '001', quantity: 3 }]) }).row
    s.markFailed(r.clientId, 'x')
    expect(s.activeSaleQuantities({ since: null }).size).toBe(0)
  })
})

describe('purge y meta', () => {
  it('purga SENT de más de 7 días, REVIEW y FAILED descartados de más de 30; conserva el resto', () => {
    const s = open()
    const now = new Date('2026-03-01T00:00:00Z')
    const old = new Date(now.getTime() - SENT_RETENTION_MS - 1000).toISOString()
    const veryOld = new Date(now.getTime() - DISMISSED_RETENTION_MS - 1000).toISOString()
    const recent = new Date(now.getTime() - 1000).toISOString()
    const mk = () => s.enqueue({ type: 'SALE', payload: '{}' }).row.clientId
    const sentOld = mk(); const sentNew = mk(); const reviewOld = mk(); const pending = mk()
    const failedOld = mk(); const failedRecent = mk(); const failedNotDismissed = mk()
    s.markSent(sentOld, { serverId: '1', sentAt: old })
    s.markSent(sentNew, { serverId: '2', sentAt: recent })
    s.markReview(reviewOld, { serverId: '3', sentAt: veryOld }, '{}')
    const reviewMid = mk()
    s.markReview(reviewMid, { serverId: '4', sentAt: old }, '{}') // 7 d < edad < 30 d: REVIEW se conserva
    for (const id of [failedOld, failedRecent, failedNotDismissed]) s.markFailed(id, 'e')
    s.dismiss(failedOld, new Date(now.getTime() - DISMISSED_RETENTION_MS - 1000))
    s.dismiss(failedRecent, new Date(now.getTime() - 1000))

    expect(s.purge(now)).toBe(3) // sentOld, reviewOld, failedOld
    const left = s.list({ includeDismissed: true, limit: 200 }).map((r) => r.clientId).sort()
    expect(left).toEqual([sentNew, reviewMid, pending, failedRecent, failedNotDismissed].sort())
  })

  it('un PENDING nunca se purga por viejo que sea', () => {
    const s = open()
    s.enqueue({ type: 'SALE', payload: '{}', createdAt: '2020-01-01T00:00:00.000Z' })
    expect(s.purge(new Date('2030-01-01T00:00:00Z'))).toBe(0)
    expect(s.counts().pending).toBe(1)
  })

  it('outbox_meta: get/set con upsert', () => {
    const s = open()
    expect(s.getMeta('legacy_imported')).toBeNull()
    s.setMeta('legacy_imported', '1')
    s.setMeta('legacy_imported', '2')
    expect(s.getMeta('legacy_imported')).toBe('2')
  })
})
