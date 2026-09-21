// @vitest-environment node
import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LATEST_SCHEMA_VERSION, MIGRATIONS } from './migrations'
import { resolveDbPath, SqliteCatalogStore, wipeTenantFiles } from './sqlite-store'

const TENANT = '724c4579-ea83-4cef-9f37-bcfbfcc12268'
const OTHER = '11111111-2222-3333-4444-555555555555'

let dir: string
let stores: SqliteCatalogStore[]
let log: ReturnType<typeof vi.fn>

const open = (tenantId = TENANT) => {
  const s = SqliteCatalogStore.open({ dataDir: dir, tenantId, Database, log })
  stores.push(s)
  return s
}
const product = (id: number, code: string, extra: Record<string, unknown> = {}) => ({ id, code, name: `P${id}`, ...extra })

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omero-catalog-test-'))
  stores = []
  log = vi.fn()
})
afterEach(() => {
  for (const s of stores) s.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('resolveDbPath / seguridad de la ruta', () => {
  it('arma <dataDir>/<uuid>.sqlite en minúsculas', () => {
    expect(resolveDbPath(dir, TENANT.toUpperCase())).toBe(path.join(dir, `${TENANT}.sqlite`))
  })

  it.each(['../evil', '../../etc/passwd', 'no-uuid', '', `${TENANT}/../x`, `${TENANT}.sqlite`])('rechaza tenantId inválido: %j', (bad) => {
    expect(() => resolveDbPath(dir, bad)).toThrow(/tenantId inválido/)
  })

  it('open() con un tenantId malicioso lanza y no crea nada', () => {
    const target = path.join(dir, 'sub')
    expect(() => SqliteCatalogStore.open({ dataDir: target, tenantId: '../evil', Database, log })).toThrow()
    expect(fs.existsSync(target)).toBe(false)
  })
})

describe('apertura y migraciones', () => {
  it('crea el directorio y la base con el esquema más nuevo, en modo WAL', () => {
    const nested = path.join(dir, 'a', 'b')
    const s = SqliteCatalogStore.open({ dataDir: nested, tenantId: TENANT, Database })
    stores.push(s)
    const file = path.join(nested, `${TENANT}.sqlite`)
    expect(fs.existsSync(file)).toBe(true)
    const raw = new Database(file, { readonly: true })
    expect(raw.pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)
    expect(raw.pragma('journal_mode', { simple: true })).toBe('wal')
    raw.close()
  })

  it('migra una base existente en v0 (sin tablas) a la última versión', () => {
    const file = path.join(dir, `${TENANT}.sqlite`)
    const pre = new Database(file)
    pre.pragma('user_version = 0')
    pre.close()
    const s = open()
    s.replaceProducts([product(1, '001')])
    expect(s.getProducts()).toHaveLength(1)
  })

  it('reabrir una base ya migrada conserva los datos', () => {
    const s = open()
    s.replaceProducts([product(1, '001'), product(2, '002')])
    s.close()
    const again = open()
    expect(again.getProducts()).toHaveLength(2)
    expect(again.getMeta('products')?.itemCount).toBe(2)
  })

  it('esquema más nuevo que el soportado (downgrade) → se descarta y se recrea, con log', () => {
    const file = path.join(dir, `${TENANT}.sqlite`)
    const future = new Database(file)
    future.exec('CREATE TABLE futuro (x)')
    future.pragma(`user_version = ${LATEST_SCHEMA_VERSION + 5}`)
    future.close()

    const s = open()
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/descartada.*OMERO_SCHEMA_TOO_NEW/))
    expect(s.getMeta('products')).toBeNull()
    s.replaceProducts([product(1, '001')])
    expect(s.getProducts()).toHaveLength(1)
  })

  it('archivo corrupto / no-SQLite → se elimina y se recrea, con log', () => {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, `${TENANT}.sqlite`), Buffer.from('esto no es una base sqlite '.repeat(200)))
    const s = open()
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/descartada/))
    s.replaceProducts([product(1, '001')])
    expect(s.getProducts()).toHaveLength(1)
  })

  it('un binding inexistente es un error real (no se confunde con corrupción)', () => {
    expect(() =>
      SqliteCatalogStore.open({ dataDir: dir, tenantId: TENANT, Database, nativeBinding: path.join(dir, 'no-existe.node') }),
    ).toThrow()
  })
})

describe('snapshots de productos', () => {
  it('reemplaza la lista completa y conserva el orden del backend', () => {
    const s = open()
    const res = s.replaceProducts([product(3, '003'), product(1, '001'), product(2, '002')], new Date('2026-01-01T10:00:00Z'))
    expect(res).toEqual({ written: true, itemCount: 3, lastSyncAt: '2026-01-01T10:00:00.000Z' })
    expect(s.getProducts().map((j) => JSON.parse(j).id)).toEqual([3, 1, 2])
    expect(s.getMeta('products')).toEqual({ resource: 'products', lastSyncAt: '2026-01-01T10:00:00.000Z', itemCount: 3 })
  })

  it('guarda el JSON crudo tal cual (mismos campos que el backend)', () => {
    const s = open()
    const p = product(1, '001', { sellingPrice: 1000, category: { id: 'x', name: 'Bebidas' }, extraFuturo: [1, 2] })
    s.replaceProducts([p])
    expect(JSON.parse(s.getProducts()[0])).toEqual(p)
  })

  it('un producto eliminado en el backend desaparece en el siguiente snapshot', () => {
    const s = open()
    s.replaceProducts([product(1, '001'), product(2, '002')])
    s.replaceProducts([product(1, '001')])
    expect(s.getProducts().map((j) => JSON.parse(j).id)).toEqual([1])
    expect(s.findProduct('002')).toBeNull()
  })

  it('payload idéntico → no reescribe, solo actualiza la fecha', () => {
    const s = open()
    const items = [product(1, '001'), product(2, '002')]
    expect(s.replaceProducts(items, new Date('2026-01-01T10:00:00Z')).written).toBe(true)
    const second = s.replaceProducts(items, new Date('2026-01-01T10:05:00Z'))
    expect(second).toEqual({ written: false, itemCount: 2, lastSyncAt: '2026-01-01T10:05:00.000Z' })
    expect(s.getMeta('products')?.lastSyncAt).toBe('2026-01-01T10:05:00.000Z')
    expect(s.getProducts()).toHaveLength(2)
  })

  it('payload distinto → reescribe', () => {
    const s = open()
    s.replaceProducts([product(1, '001')])
    const res = s.replaceProducts([product(1, '001', { sellingPrice: 999 })])
    expect(res.written).toBe(true)
    expect(JSON.parse(s.getProducts()[0]).sellingPrice).toBe(999)
  })

  it('una lista vacía es un snapshot válido', () => {
    const s = open()
    s.replaceProducts([product(1, '001')])
    const res = s.replaceProducts([])
    expect(res).toMatchObject({ written: true, itemCount: 0 })
    expect(s.getProducts()).toEqual([])
    expect(s.getMeta('products')?.itemCount).toBe(0)
  })

  it('es transaccional: si falla a mitad queda intacto el snapshot anterior', () => {
    const s = open()
    s.replaceProducts([product(1, '001'), product(2, '002')], new Date('2026-01-01T10:00:00Z'))
    const boom = { id: 9, code: '009', barcode: { toString: () => { throw new Error('boom') } } }
    expect(() => s.replaceProducts([product(5, '005'), boom as never])).toThrow('boom')
    expect(s.getProducts().map((j) => JSON.parse(j).id)).toEqual([1, 2])
    expect(s.getMeta('products')?.lastSyncAt).toBe('2026-01-01T10:00:00.000Z')
  })
})

describe('upsertProduct', () => {
  it('inserta un producto nuevo sin tocar sync_meta', () => {
    const s = open()
    s.upsertProduct(product(1, '001'))
    expect(s.findProduct('001')).not.toBeNull()
    expect(s.getMeta('products')).toBeNull() // no hubo snapshot completo: no se puede servir una lista parcial
  })

  it('actualiza uno existente CONSERVANDO su posición (INSERT OR REPLACE lo movería al final)', () => {
    const s = open()
    s.replaceProducts([product(0, '000'), product(1, '001'), product(2, '002')])
    s.upsertProduct(product(0, '000', { sellingPrice: 55 }))
    const ids = s.getProducts().map((j) => JSON.parse(j).id)
    expect(ids).toEqual([0, 1, 2])
    expect(JSON.parse(s.getProducts()[0]).sellingPrice).toBe(55)
  })

  it('actualiza los índices de búsqueda (code y barcode)', () => {
    const s = open()
    s.upsertProduct(product(1, '001', { barcode: 7790001 }))
    s.upsertProduct(product(1, '010', { barcode: 7790002 }))
    expect(s.findProduct('001')).toBeNull()
    expect(s.findProduct('7790001')).toBeNull()
    expect(s.findProduct('010')).not.toBeNull()
    expect(s.findProduct('7790002')).not.toBeNull()
  })
})

describe('findProduct', () => {
  it('busca por código, luego código de barras, luego id (mismo orden que el POS)', () => {
    const s = open()
    s.replaceProducts([
      product(1, '005', { name: 'por-codigo' }),
      product(5, '900', { name: 'por-id' }),
      product(2, '333', { barcode: 5, name: 'por-barcode' }),
    ])
    expect(JSON.parse(s.findProduct('005')!).name).toBe('por-codigo') // código gana a id
    expect(JSON.parse(s.findProduct('5')!).name).toBe('por-barcode') // barcode gana a id
    expect(JSON.parse(s.findProduct('900')!).name).toBe('por-id') // code
    expect(s.findProduct('999999')).toBeNull()
  })

  it('el código de barras numérico se busca como texto', () => {
    const s = open()
    s.replaceProducts([product(1, '001', { barcode: 7791234567890 })])
    expect(s.findProduct('7791234567890')).not.toBeNull()
  })
})

describe('promociones', () => {
  it('snapshot, lectura, meta y hash-skip', () => {
    const s = open()
    const promos = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]
    expect(s.replacePromotions(promos, new Date('2026-01-01T00:00:00Z')).written).toBe(true)
    expect(s.getPromotions().map((j) => JSON.parse(j).id)).toEqual(['a', 'b'])
    expect(s.getMeta('promotions')?.itemCount).toBe(2)
    expect(s.replacePromotions(promos).written).toBe(false)
    expect(s.replacePromotions([{ id: 'a', name: 'A' }]).written).toBe(true)
    expect(s.getPromotions()).toHaveLength(1)
  })

  it('los recursos son independientes (products vs promotions)', () => {
    const s = open()
    s.replaceProducts([product(1, '001')])
    expect(s.getMeta('promotions')).toBeNull()
  })
})

describe('settings (configuración de negocio)', () => {
  it('guarda y lee el JSON crudo con la fecha del sync; upsert reemplaza', () => {
    const s = open()
    expect(s.getSetting('mp_offline')).toBeNull()
    s.upsertSetting('mp_offline', '{"key":"mp_offline","value":"false"}', new Date('2026-01-01T10:00:00Z'))
    expect(s.getSetting('mp_offline')).toEqual({ json: '{"key":"mp_offline","value":"false"}', syncedAt: '2026-01-01T10:00:00.000Z' })
    s.upsertSetting('mp_offline', '{"key":"mp_offline","value":"true"}', new Date('2026-01-01T10:05:00Z'))
    expect(JSON.parse(s.getSetting('mp_offline')!.json).value).toBe('true')
  })

  it('las claves son independientes y no afectan a products/promotions', () => {
    const s = open()
    s.upsertSetting('a', '{"v":1}')
    s.upsertSetting('b', '{"v":2}')
    expect(s.getSetting('a')!.json).toBe('{"v":1}')
    expect(s.getMeta('products')).toBeNull()
  })

  it('una base v1 (sin settings) migra a v2 conservando productos y promociones', () => {
    const file = path.join(dir, `${TENANT}.sqlite`)
    const v1 = new Database(file)
    v1.exec(MIGRATIONS[0].sql)
    v1.pragma('user_version = 1')
    v1.prepare('INSERT INTO products (id, code, barcode, json) VALUES (?, ?, ?, ?)').run('1', '001', null, '{"id":1,"code":"001"}')
    v1.close()

    const s = open()
    expect(s.getProducts()).toEqual(['{"id":1,"code":"001"}'])
    s.upsertSetting('mp_offline', '{}')
    expect(s.getSetting('mp_offline')).not.toBeNull()
    const raw = new Database(file, { readonly: true })
    expect(raw.pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)
    raw.close()
  })
})

describe('aislamiento, cierre y borrado', () => {
  it('cada tenant tiene su propia base', () => {
    const a = open(TENANT)
    const b = open(OTHER)
    a.replaceProducts([product(1, '001')])
    expect(b.getProducts()).toEqual([])
    expect(fs.existsSync(path.join(dir, `${OTHER}.sqlite`))).toBe(true)
  })

  it('wipe() cierra y borra .sqlite, -wal y -shm', () => {
    const s = open()
    s.replaceProducts([product(1, '001')])
    const file = path.join(dir, `${TENANT}.sqlite`)
    expect(fs.existsSync(file)).toBe(true)
    s.wipe()
    expect(fs.existsSync(file)).toBe(false)
    expect(fs.existsSync(`${file}-wal`)).toBe(false)
    expect(fs.existsSync(`${file}-shm`)).toBe(false)
    expect(() => s.getProducts()).toThrow(/cerrada/)
  })

  it('wipeTenantFiles borra sin abrir y no falla si no existe', () => {
    const s = open()
    s.replaceProducts([product(1, '001')])
    s.close()
    wipeTenantFiles(dir, TENANT)
    expect(fs.existsSync(path.join(dir, `${TENANT}.sqlite`))).toBe(false)
    expect(() => wipeTenantFiles(dir, TENANT)).not.toThrow()
    expect(() => wipeTenantFiles(dir, '../x')).toThrow()
  })

  it('close() es idempotente y después de cerrar las operaciones lanzan', () => {
    const s = open()
    s.close()
    expect(() => s.close()).not.toThrow()
    expect(() => s.getMeta('products')).toThrow(/cerrada/)
  })

  it('tras un wipe se puede volver a abrir una base limpia', () => {
    const s = open()
    s.replaceProducts([product(1, '001')])
    s.wipe()
    const fresh = open()
    expect(fresh.getProducts()).toEqual([])
    expect(fresh.getMeta('products')).toBeNull()
  })
})
