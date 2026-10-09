import { describe, expect, it } from 'vitest'
import fixtures from './__fixtures__/quantity-cases.json'
import {
  allowsUnit, approxUnits, defaultUnit, formatKg, formatQuantity, formatStock, isMixed, lineTotal, parseDecimal,
  priceFor, priceSuffix, quantityProblem, roundKg, roundMoney, saleFormatOf, stockQuantity, toCents, toGrams,
  tracksWeight, unitCostFor, unitPriceOf, weightFromAmount,
  type QuantityProduct, type QuantityUnit,
} from './quantity'

interface FixtureCase {
  name: string
  product: Record<string, string | number | null>
  unit: QuantityUnit
  quantity: string
  expect: { valid: boolean; stockQty?: string; unitCost?: string; unitPrice?: string; lineTotal?: string }
}

const num = (v: string | number | null | undefined) => (v == null ? null : Number(v))
const toProduct = (p: FixtureCase['product']): QuantityProduct => ({
  name: 'Producto de prueba',
  saleFormat: String(p.saleFormat),
  costPrice: num(p.costPrice),
  sellingPrice: num(p.sellingPrice),
  unitWeightKg: num(p.unitWeightKg),
  unitPrice: num(p.unitPrice),
  rounding: num(p.rounding) ?? 0,
})

/** Los mismos casos que `QuantityMathTest` del backend: los cálculos tienen que coincidir. */
describe('casos compartidos con el backend (quantity-cases.json)', () => {
  for (const c of (fixtures as { cases: FixtureCase[] }).cases) {
    it(c.name, () => {
      const product = toProduct(c.product)
      const quantity = Number(c.quantity)
      const valid = quantityProblem(product, c.unit, quantity) === null
      expect(valid).toBe(c.expect.valid)
      if (!valid) return

      const unitPrice = priceFor(product, c.unit)
      expect(stockQuantity(product, c.unit, quantity)).toBe(Number(c.expect.stockQty))
      expect(unitCostFor(product, c.unit)).toBe(Number(c.expect.unitCost))
      expect(unitPrice).toBe(Number(c.expect.unitPrice))
      expect(lineTotal(quantity, unitPrice!)).toBe(Number(c.expect.lineTotal))
    })
  }
})

describe('formatos de venta', () => {
  it('lo desconocido o ausente es por unidad', () => {
    expect(saleFormatOf({})).toBe('UNIT')
    expect(saleFormatOf({ saleFormat: null })).toBe('UNIT')
    expect(saleFormatOf({ saleFormat: 'LITROS' })).toBe('UNIT')
    expect(saleFormatOf({ saleFormat: 'GRAMS' })).toBe('GRAMS')
    expect(saleFormatOf({ saleFormat: 'MIXED' })).toBe('MIXED')
  })

  it('unidad por defecto y unidades permitidas', () => {
    expect(defaultUnit({ saleFormat: 'UNIT' })).toBe('UNIT')
    expect(defaultUnit({ saleFormat: 'GRAMS' })).toBe('KG')
    expect(defaultUnit({ saleFormat: 'MIXED' })).toBe('UNIT')
    expect(allowsUnit({ saleFormat: 'UNIT' }, 'KG')).toBe(false)
    expect(allowsUnit({ saleFormat: 'GRAMS' }, 'UNIT')).toBe(false)
    expect(allowsUnit({ saleFormat: 'MIXED' }, 'UNIT')).toBe(true)
    expect(allowsUnit({ saleFormat: 'MIXED' }, 'KG')).toBe(true)
    expect(tracksWeight({ saleFormat: 'UNIT' })).toBe(false)
    expect(tracksWeight({ saleFormat: 'GRAMS' })).toBe(true)
    expect(isMixed({ saleFormat: 'MIXED' })).toBe(true)
    expect(isMixed({ saleFormat: 'GRAMS' })).toBe(false)
  })
})

describe('precios', () => {
  it('GRAMS no tiene precio por unidad', () => {
    expect(unitPriceOf({ saleFormat: 'GRAMS', sellingPrice: 12000 })).toBeNull()
    expect(priceFor({ saleFormat: 'GRAMS', sellingPrice: 12000 }, 'KG')).toBe(12000)
  })

  it('MIXED sin datos suficientes no tiene precio por unidad', () => {
    expect(unitPriceOf({ saleFormat: 'MIXED', sellingPrice: 8000 })).toBeNull()
    expect(unitPriceOf({ saleFormat: 'MIXED', unitWeightKg: 0.25 })).toBeNull()
    expect(unitPriceOf({ saleFormat: 'UNIT' })).toBeNull()
  })

  it('un precio por unidad en 0 se trata como derivado', () => {
    expect(unitPriceOf({ saleFormat: 'MIXED', sellingPrice: 8000, unitWeightKg: 0.25, unitPrice: 0 })).toBe(2000)
  })

  it('el importe no arrastra errores de punto flotante', () => {
    expect(lineTotal(0.35, 12000)).toBe(4200)
    expect(lineTotal(3, 0.1)).toBe(0.3)        // 0.1 * 3 = 0.30000000000000004
    expect(lineTotal(0.333, 12999.99)).toBe(4329)
    expect(lineTotal(1.005, 100)).toBe(100.5)
  })

  it('peso a partir de un importe (etiqueta con importe)', () => {
    expect(weightFromAmount(4200, 12000)).toBe(0.35)
    expect(weightFromAmount(1000, 3000)).toBe(0.333)
    expect(weightFromAmount(4200, 0)).toBeNull()
    expect(weightFromAmount(0, 12000)).toBeNull()
  })
})

describe('stock y costo', () => {
  it('redondea a gramos y a centavos', () => {
    expect(toGrams(0.35)).toBe(350)
    expect(toCents(1099.99)).toBe(109999)
    expect(roundKg(0.1 + 0.2)).toBe(0.3)
    expect(roundMoney(1.005)).toBe(1.01)
  })

  it('un producto sin costo cuesta 0', () => {
    expect(unitCostFor({ saleFormat: 'MIXED', unitWeightKg: 0.25 }, 'UNIT')).toBe(0)
    expect(unitCostFor({ saleFormat: 'UNIT' }, 'UNIT')).toBe(0)
  })

  it('unidades aproximadas de un stock en kg', () => {
    expect(approxUnits({ saleFormat: 'MIXED', unitWeightKg: 4 }, 12.4)).toBe(3)
    expect(approxUnits({ saleFormat: 'MIXED', unitWeightKg: 0.25 }, 1)).toBe(4)
    expect(approxUnits({ saleFormat: 'GRAMS', unitWeightKg: 4 }, 12.4)).toBeNull()
    expect(approxUnits({ saleFormat: 'MIXED' }, 12.4)).toBeNull()
  })
})

describe('validación', () => {
  it('explica el problema con el nombre del producto', () => {
    expect(quantityProblem({ name: 'Gaseosa', saleFormat: 'UNIT' }, 'KG', 0.5)).toContain('"Gaseosa" se vende por unidad')
    expect(quantityProblem({ name: 'Jamón', saleFormat: 'GRAMS' }, 'UNIT', 2)).toContain('"Jamón" se vende por peso')
    expect(quantityProblem({ saleFormat: 'UNIT' }, 'KG', 0.5)).toContain('El producto se vende por unidad')
    expect(quantityProblem({ saleFormat: 'UNIT' }, 'UNIT', NaN)).toContain('mayor a 0')
  })

  it('un mixto sin peso por unidad no se puede vender por unidad', () => {
    expect(quantityProblem({ name: 'Pan', saleFormat: 'MIXED' }, 'UNIT', 2)).toContain('peso por unidad')
    expect(quantityProblem({ name: 'Pan', saleFormat: 'MIXED' }, 'KG', 0.4)).toBeNull()
  })
})

describe('formato y parseo es-AR', () => {
  it('formatea peso, cantidad y stock', () => {
    expect(formatKg(0.35)).toBe('0,350 kg')
    expect(formatKg(1234.5)).toBe('1.234,500 kg')
    expect(formatQuantity(3, 'UNIT')).toBe('3')
    expect(formatQuantity(0.35, 'KG')).toBe('0,350 kg')
    expect(formatStock({ saleFormat: 'UNIT' }, 48)).toBe('48 u')
    expect(formatStock({ saleFormat: 'GRAMS' }, 12.4)).toBe('12,400 kg')
    expect(formatStock({ saleFormat: 'MIXED', unitWeightKg: 4 }, 12.4)).toBe('12,400 kg · ≈ 3 u')
    expect(priceSuffix({ saleFormat: 'GRAMS' })).toBe('/kg')
    expect(priceSuffix({ saleFormat: 'UNIT' })).toBe('/u')
  })

  it('parsea coma o punto decimal', () => {
    expect(parseDecimal('0,35')).toBe(0.35)
    expect(parseDecimal('0.35')).toBe(0.35)
    expect(parseDecimal(' 1.234,5 ')).toBe(1234.5)
    expect(parseDecimal('1,234.5')).toBe(1234.5)
    expect(parseDecimal('350')).toBe(350)
    expect(parseDecimal('.5')).toBe(0.5)
    expect(parseDecimal('5.')).toBe(5)
    expect(parseDecimal('')).toBeNull()
    expect(parseDecimal(null)).toBeNull()
    expect(parseDecimal('abc')).toBeNull()
    expect(parseDecimal('1,2,3')).toBeNull()
  })
})
