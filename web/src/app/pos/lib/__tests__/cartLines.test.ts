import { describe, expect, it } from 'vitest'
import {
  isMixedProduct, isWeightLine, lineQuantityLabel, lineStockQuantity, needsWeightEntry, newLineId, stockInCart,
  toQuantityProduct, unitLine, unitPriceOfProduct, weightLine,
} from '../cartLines'
import { mixedProduct, unitProduct, weightProduct } from './fixtures'

describe('tipo de producto', () => {
  it('solo los productos con peso piden el peso', () => {
    expect(needsWeightEntry(unitProduct())).toBe(false)
    expect(needsWeightEntry(weightProduct())).toBe(true)
    expect(needsWeightEntry(mixedProduct())).toBe(true)
    expect(isMixedProduct(weightProduct())).toBe(false)
    expect(isMixedProduct(mixedProduct())).toBe(true)
  })

  it('un producto sin formato (caché vieja) se trata como por unidad', () => {
    const legacy = unitProduct({ saleFormat: undefined })
    expect(needsWeightEntry(legacy)).toBe(false)
    expect(toQuantityProduct(legacy).sellingPrice).toBe(1000)
  })

  it('precio de una unidad: el del producto; en mixtos el fijado o el derivado del peso', () => {
    expect(unitPriceOfProduct(unitProduct())).toBe(1000)
    expect(unitPriceOfProduct(mixedProduct())).toBe(1200)
    expect(unitPriceOfProduct(mixedProduct({ unitPrice: null }))).toBe(1000) // 4000 × 0,250
    expect(unitPriceOfProduct(unitProduct({ price: undefined as unknown as number }))).toBe(0)
  })
})

describe('líneas', () => {
  it('línea por unidad', () => {
    const line = unitLine(unitProduct(), 3)
    expect(line).toMatchObject({ code: '001', price: 1000, quantity: 3, total: 3000, originalPrice: 1000, saleUnit: 'UNIT' })
    expect(line.stockPerUnit).toBeUndefined()
    expect(isWeightLine(line)).toBe(false)
    expect(lineStockQuantity(line)).toBe(3)
    expect(lineQuantityLabel(line)).toBe('3')
  })

  it('línea por unidad de un producto mixto: cobra el precio por unidad y descuenta kilos', () => {
    const line = unitLine(mixedProduct(), 3)
    expect(line).toMatchObject({ price: 1200, quantity: 3, total: 3600, saleUnit: 'UNIT', stockPerUnit: 0.25 })
    expect(lineStockQuantity(line)).toBe(0.75)
  })

  it('conserva el precio original al acumular (promociones)', () => {
    expect(unitLine(unitProduct(), 2, 900).originalPrice).toBe(900)
  })

  it('línea por peso: importe = kg × precio, redondeado a centavos', () => {
    const line = weightLine(weightProduct(), 0.35)
    expect(line).toMatchObject({ price: 8000, quantity: 0.35, total: 2800, saleUnit: 'KG' })
    expect(line.fixedTotal).toBeUndefined()
    expect(isWeightLine(line)).toBe(true)
    expect(lineStockQuantity(line)).toBe(0.35)
    expect(lineQuantityLabel(line)).toBe('0,350 kg')
    expect(weightLine(weightProduct({ price: 7999 }), 0.333).total).toBe(2663.67)
  })

  it('con importe de etiqueta se cobra ese importe y queda marcado', () => {
    const line = weightLine(weightProduct(), 0.525, 4200)
    expect(line).toMatchObject({ quantity: 0.525, total: 4200, fixedTotal: true })
  })

  it('los ids de línea no se repiten', () => {
    expect(new Set(Array.from({ length: 50 }, newLineId)).size).toBe(50)
  })
})

describe('stockInCart', () => {
  it('suma en la unidad base lo que cada línea descuenta', () => {
    const product = mixedProduct()
    const a = weightLine(product, 0.4)
    const b = unitLine(product, 2) // 0,5 kg
    const other = unitLine(unitProduct(), 9)
    expect(stockInCart([a, b, other], '003')).toBe(0.9)
    expect(stockInCart([a, b, other], '003', a.id)).toBe(0.5)
    expect(stockInCart([a, b, other], '001')).toBe(9)
    expect(stockInCart([], '003')).toBe(0)
  })

  it('no arrastra ruido de punto flotante', () => {
    const product = weightProduct()
    expect(stockInCart([weightLine(product, 0.1), weightLine(product, 0.2)], '002')).toBe(0.3)
  })
})
