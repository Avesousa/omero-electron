// @vitest-environment node
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { LATEST_SCHEMA_VERSION, MIGRATIONS } from './migrations'

describe('MIGRATIONS', () => {
  it('versiones consecutivas desde 1 y LATEST coincide con la última', () => {
    MIGRATIONS.forEach((m, i) => expect(m.version).toBe(i + 1))
    expect(LATEST_SCHEMA_VERSION).toBe(MIGRATIONS[MIGRATIONS.length - 1].version)
  })

  it('cada migración tiene descripción y SQL', () => {
    for (const m of MIGRATIONS) {
      expect(m.description.length).toBeGreaterThan(0)
      expect(m.sql.trim().length).toBeGreaterThan(0)
    }
  })

  it('aplicadas en orden sobre una base vacía crean el esquema esperado', () => {
    const db = new Database(':memory:')
    for (const m of MIGRATIONS) db.exec(m.sql)
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]).map((r) => r.name)
    expect(tables).toEqual(expect.arrayContaining(['products', 'promotions', 'sync_meta']))
    const indexes = (db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as { name: string }[]).map((r) => r.name)
    expect(indexes).toEqual(expect.arrayContaining(['idx_products_code', 'idx_products_barcode']))
    db.close()
  })
})
