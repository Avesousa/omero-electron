// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { matchCatalogRoute } from './cache-policy'

describe('matchCatalogRoute', () => {
  it('lista de productos y de promociones sin query', () => {
    expect(matchCatalogRoute('GET', '/api/products', '')).toEqual({ kind: 'products' })
    expect(matchCatalogRoute('GET', '/api/promotions', '')).toEqual({ kind: 'promotions' })
  })

  it('un "?" vacío cuenta como sin query', () => {
    expect(matchCatalogRoute('GET', '/api/products', '?')).toEqual({ kind: 'products' })
  })

  it('tolera la barra final', () => {
    expect(matchCatalogRoute('GET', '/api/products/', '')).toEqual({ kind: 'products' })
    expect(matchCatalogRoute('GET', '/api/promotions/', '')).toEqual({ kind: 'promotions' })
  })

  it('producto por código/código de barras/id numérico', () => {
    expect(matchCatalogRoute('GET', '/api/products/001', '')).toEqual({ kind: 'product', code: '001' })
    expect(matchCatalogRoute('GET', '/api/products/7791234567890', '')).toEqual({ kind: 'product', code: '7791234567890' })
    expect(matchCatalogRoute('get', '/api/products/12', '')).toEqual({ kind: 'product', code: '12' })
  })

  it.each(['/api/products/search', '/api/products/bulk-upload', '/api/products/abc', '/api/products/12abc', '/api/products/-1'])(
    'no cachea rutas con nombre o no numéricas: %s',
    (path) => {
      expect(matchCatalogRoute('GET', path, '')).toBeNull()
    },
  )

  it('no cachea si trae query (una lista filtrada sería incorrecta)', () => {
    expect(matchCatalogRoute('GET', '/api/products', '?categoryId=1')).toBeNull()
    expect(matchCatalogRoute('GET', '/api/promotions', '?status=ACTIVE')).toBeNull()
    expect(matchCatalogRoute('GET', '/api/products/001', '?x=1')).toBeNull()
  })

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])('solo GET: %s no aplica', (method) => {
    expect(matchCatalogRoute(method, '/api/products', '')).toBeNull()
    expect(matchCatalogRoute(method, '/api/products/001', '')).toBeNull()
  })

  it.each(['/api/products/001/stock', '/api/products/1/2', '/api/sales', '/api/expenses', '/api/promotions/5', '/products', '/api'])(
    'otras rutas no aplican: %s',
    (path) => {
      expect(matchCatalogRoute('GET', path, '')).toBeNull()
    },
  )

  it('configuración de negocio por clave (p. ej. mp_offline)', () => {
    expect(matchCatalogRoute('GET', '/api/business/config/mp_offline', '')).toEqual({ kind: 'setting', key: 'mp_offline' })
    expect(matchCatalogRoute('GET', '/api/business/config/currency/', '')).toEqual({ kind: 'setting', key: 'currency' })
  })

  it.each(['/api/business/config', '/api/business/config/', '/api/business/config/a-b', '/api/business/config/a/b', '/api/business/config/mp offline'])(
    'no cachea la lista completa ni claves raras: %s',
    (path) => {
      expect(matchCatalogRoute('GET', path, '')).toBeNull()
    },
  )

  it('la config solo se cachea con GET y sin query', () => {
    expect(matchCatalogRoute('PUT', '/api/business/config/mp_offline', '')).toBeNull()
    expect(matchCatalogRoute('GET', '/api/business/config/mp_offline', '?x=1')).toBeNull()
  })

  it('rechaza códigos absurdamente largos (>20 dígitos)', () => {
    expect(matchCatalogRoute('GET', `/api/products/${'1'.repeat(21)}`, '')).toBeNull()
  })
})
