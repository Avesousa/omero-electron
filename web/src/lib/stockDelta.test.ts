import { describe, expect, it } from 'vitest'
import { mergeStock, parseStockDelta, stockVersionOf } from './stockDelta'

describe('parseStockDelta', () => {
  it('forma válida', () => {
    expect(parseStockDelta({ version: 7, items: [{ code: 'A', stock: 3 }, { code: 'B', stock: 0.5 }] })).toEqual({
      version: 7,
      items: [{ code: 'A', stock: 3 }, { code: 'B', stock: 0.5 }],
    })
    expect(parseStockDelta({ version: 0, items: [] })).toEqual({ version: 0, items: [] })
  })
  it.each([
    ['null', null],
    ['sin versión', { items: [] }],
    ['versión no entera', { version: 1.5, items: [] }],
    ['versión negativa', { version: -1, items: [] }],
    ['versión texto', { version: '3', items: [] }],
    ['sin items', { version: 1 }],
    ['item no objeto', { version: 1, items: ['x'] }],
    ['código vacío', { version: 1, items: [{ code: '', stock: 1 }] }],
    ['código no string', { version: 1, items: [{ code: 5, stock: 1 }] }],
    ['stock NaN', { version: 1, items: [{ code: 'A', stock: NaN }] }],
    ['stock texto', { version: 1, items: [{ code: 'A', stock: '3' }] }],
    ['stock infinito', { version: 1, items: [{ code: 'A', stock: Infinity }] }],
  ])('inválido: %s → null', (_n, raw) => {
    expect(parseStockDelta(raw)).toBeNull()
  })
})

describe('mergeStock', () => {
  const products = [{ code: 'A', stock: 1, name: 'a' }, { code: 'B', stock: 2, name: 'b' }]
  it('actualiza solo el stock de los códigos que vienen', () => {
    expect(mergeStock(products, [{ code: 'B', stock: 9 }])).toEqual([{ code: 'A', stock: 1, name: 'a' }, { code: 'B', stock: 9, name: 'b' }])
  })
  it('ignora códigos desconocidos y no muta la entrada', () => {
    const r = mergeStock(products, [{ code: 'Z', stock: 5 }])
    expect(r).toBe(products)
    mergeStock(products, [{ code: 'A', stock: 100 }])
    expect(products[0].stock).toBe(1)
  })
  it('misma referencia si nada cambia', () => {
    expect(mergeStock(products, [{ code: 'A', stock: 1 }])).toBe(products)
    expect(mergeStock(products, [])).toBe(products)
  })
})

describe('stockVersionOf', () => {
  it('prefiere X-Omero-Stock-Version (desktop)', () => {
    expect(stockVersionOf(new Headers({ 'X-Omero-Stock-Version': '42', ETag: '"3-17"' }))).toBe(42)
  })
  it('sin header propio usa el ETag (web)', () => {
    expect(stockVersionOf(new Headers({ ETag: '"3-17"' }))).toBe(17)
  })
  it('header propio inválido cae al ETag; sin nada → null', () => {
    expect(stockVersionOf(new Headers({ 'X-Omero-Stock-Version': 'abc', ETag: '"3-9"' }))).toBe(9)
    expect(stockVersionOf(new Headers({ ETag: 'W/"3-9"' }))).toBeNull()
    expect(stockVersionOf(new Headers())).toBeNull()
    expect(stockVersionOf(null)).toBeNull()
    expect(stockVersionOf(undefined)).toBeNull()
  })
})
