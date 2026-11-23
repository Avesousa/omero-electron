import { describe, expect, it } from 'vitest'
import { parseProductsEtag, withStockVersion } from './etag'

describe('parseProductsEtag', () => {
  it('lee catálogo y stock', () => {
    expect(parseProductsEtag('"12-345"')).toEqual({ cat: '12', stock: 345 })
    expect(parseProductsEtag(' "0-0" ')).toEqual({ cat: '0', stock: 0 })
  })

  it.each([null, undefined, '', '12-345', 'W/"12-345"', '"12"', '"a-b"', '"12-"', '"-3"', '"1-2-3"', '"12-345678901234567890"'])(
    'devuelve null para %s',
    value => {
      expect(parseProductsEtag(value as string | null | undefined)).toBeNull()
    },
  )
})

describe('withStockVersion', () => {
  it('recompone con la nueva versión de stock', () => {
    expect(withStockVersion('"12-345"', 400)).toBe('"12-400"')
  })

  it('null si el ETag no tiene el formato o la versión es inválida', () => {
    expect(withStockVersion('W/"1-2"', 3)).toBeNull()
    expect(withStockVersion(null, 3)).toBeNull()
    expect(withStockVersion('"1-2"', -1)).toBeNull()
    expect(withStockVersion('"1-2"', 1.5)).toBeNull()
  })
})
