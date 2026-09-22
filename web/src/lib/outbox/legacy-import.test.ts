// @vitest-environment node
import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { importLegacyQueue, legacyClientId, MAX_LEGACY_ITEMS } from './legacy-import'
import { OutboxStore } from './outbox-store'

const TENANT = '724c4579-ea83-4cef-9f37-bcfbfcc12268'
const OTHER = '11111111-2222-3333-4444-555555555555'
const NOW = new Date('2026-03-10T12:00:00Z')

let dir: string
let store: OutboxStore
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omero-legacy-'))
  store = OutboxStore.open({ dataDir: dir, tenantId: TENANT, Database, log: vi.fn() })
})
afterEach(() => {
  store.close()
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

const legacy = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  tenantId: TENANT,
  queuedAt: '2026-03-09T08:30:00.000Z',
  payload: {
    items: [{ productId: '001', quantity: 2, unitPrice: 50, total: 100, promotionId: null, promotionName: null }],
    cashAmount: 100,
    mpAmount: 0,
    change: 0,
  },
  ...extra,
})

describe('legacyClientId', () => {
  it('es un UUID estable, distinto por tenant e id', () => {
    const a = legacyClientId(TENANT, 'abc')
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(legacyClientId(TENANT, 'abc')).toBe(a)
    expect(legacyClientId(TENANT, 'abd')).not.toBe(a)
    expect(legacyClientId(OTHER, 'abc')).not.toBe(a)
  })
})

describe('importLegacyQueue', () => {
  it('importa como PENDING con la fecha original y el cajero', () => {
    const r = importLegacyQueue(store, TENANT, [legacy('a1')], 'user-1', NOW)
    expect(r).toEqual({ imported: ['a1'], rejected: [], ignored: [] })
    const row = store.getByClientId(legacyClientId(TENANT, 'a1'))!
    expect(row).toMatchObject({ status: 'PENDING', type: 'SALE', createdAt: '2026-03-09T08:30:00.000Z', sourceUserId: 'user-1' })
    expect(store.getMeta('legacy_imported_at')).toBe(NOW.toISOString())
  })

  it('importar dos veces la misma cola NO duplica y ambas confirman los ids', () => {
    importLegacyQueue(store, TENANT, [legacy('a1'), legacy('a2')], null, NOW)
    const again = importLegacyQueue(store, TENANT, [legacy('a1'), legacy('a2')], null, NOW)
    expect(again.imported).toEqual(['a1', 'a2'])
    expect(store.counts().pending).toBe(2)
  })

  it('ignora otro tenant y los que no traen tenantId; no toca nada', () => {
    const r = importLegacyQueue(store, TENANT, [legacy('b1', { tenantId: OTHER }), legacy('b2', { tenantId: undefined })], null, NOW)
    expect(r).toEqual({ imported: [], rejected: [], ignored: ['b1', 'b2'] })
    expect(store.counts().pending).toBe(0)
    expect(store.getMeta('legacy_imported_at')).toBeNull()
  })

  it('rechaza inválidos con motivo y sigue con el resto', () => {
    const r = importLegacyQueue(
      store,
      TENANT,
      [legacy('c1', { payload: null }), legacy('c2', { payload: { items: [] } }), { tenantId: TENANT }, legacy('c3')],
      null,
      NOW,
    )
    expect(r.imported).toEqual(['c3'])
    expect(r.rejected.map((x) => x.id)).toEqual(['c1', 'c2', ''])
    expect(r.rejected[0].reason).toMatch(/payload/)
  })

  it('queuedAt inválido o futuro se reemplaza por "ahora"', () => {
    importLegacyQueue(store, TENANT, [legacy('d1', { queuedAt: 'no-fecha' }), legacy('d2', { queuedAt: '2030-01-01T00:00:00Z' })], null, NOW)
    expect(store.getByClientId(legacyClientId(TENANT, 'd1'))!.createdAt).toBe(NOW.toISOString())
    expect(store.getByClientId(legacyClientId(TENANT, 'd2'))!.createdAt).toBe(NOW.toISOString())
  })

  it('descarta el costo si el payload viejo lo traía', () => {
    importLegacyQueue(store, TENANT, [legacy('e1', { payload: { ...legacy('x').payload, items: [{ ...legacy('x').payload.items[0], unitCost: 9 }] } })], null, NOW)
    expect(store.getByClientId(legacyClientId(TENANT, 'e1'))!.payload).not.toMatch(/cost/i)
  })

  it('limita el tamaño de un envío: el excedente se informa como rechazado', () => {
    const many = Array.from({ length: MAX_LEGACY_ITEMS + 2 }, (_, i) => legacy(`m${i}`))
    const r = importLegacyQueue(store, TENANT, many, null, NOW)
    expect(r.imported).toHaveLength(MAX_LEGACY_ITEMS)
    expect(r.rejected).toHaveLength(2)
  })
})
