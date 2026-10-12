import { describe, expect, it } from 'vitest'
import { DEFAULT_SCALE_CONFIG, withCheckDigit, type ScaleConfig } from '@/lib/scale'
import type { Product } from '../../types'
import { weightLine } from '../cartLines'
import { resolveScaleScan } from '../scaleScan'
import { mixedProduct, unitProduct, weightProduct } from './fixtures'

const ON: ScaleConfig = { ...DEFAULT_SCALE_CONFIG, enabled: true }
/** Etiqueta Systel de fábrica: 20 + PLU (4) + importe (6, con 2 decimales). */
const label = (plu: number, cents: number) => withCheckDigit(`20${String(plu).padStart(4, '0')}${String(cents).padStart(6, '0')}`)

const catalog = (...products: Product[]) => (plu: number) => products.find(p => Number(p.scalePlu) === plu) ?? null
const queso = weightProduct({ scalePlu: 123 })

describe('resolveScaleScan', () => {
  it('balanza apagada: nunca es una etiqueta', () => {
    expect(resolveScaleScan(label(123, 420000), DEFAULT_SCALE_CONFIG, catalog(queso))).toEqual({ kind: 'not-scale' })
  })

  it('un código de barras común no es una etiqueta', () => {
    expect(resolveScaleScan('7790001000019', ON, catalog(queso))).toEqual({ kind: 'not-scale' })
    expect(resolveScaleScan('123', ON, catalog(queso))).toEqual({ kind: 'not-scale' })
  })

  it('etiqueta con importe: se cobra el importe y el peso sale del precio por kg', () => {
    // $4.200,00 a $8.000/kg = 0,525 kg
    expect(resolveScaleScan(label(123, 420000), ON, catalog(queso))).toEqual({
      kind: 'line', product: queso, weightKg: 0.525, labelTotal: 4200,
    })
  })

  it('plantilla con peso: el importe lo calcula el POS (sin importe fijo)', () => {
    const byWeight: ScaleConfig = { ...ON, templates: ['20PPPPCCCCCC'] }
    const result = resolveScaleScan(label(123, 350), byWeight, catalog(queso)) // 0,350 kg
    expect(result).toEqual({ kind: 'line', product: queso, weightKg: 0.35 })
  })

  it('sirve también para un producto por unidad y peso', () => {
    const pan = mixedProduct({ scalePlu: 7 })
    expect(resolveScaleScan(label(7, 200000), ON, catalog(pan))).toMatchObject({ kind: 'line', weightKg: 0.5, labelTotal: 2000 })
  })

  it('PLU que no está en ningún producto', () => {
    const result = resolveScaleScan(label(999, 100000), ON, catalog(queso))
    expect(result).toMatchObject({ kind: 'error' })
    expect((result as { message: string }).message).toContain('999')
  })

  it('producto por unidad con código de balanza: no se cobra por peso', () => {
    const result = resolveScaleScan(label(5, 100000), ON, catalog(unitProduct({ scalePlu: 5 })))
    expect(result).toMatchObject({ kind: 'error' })
    expect((result as { message: string }).message).toContain('por unidad')
  })

  it('etiqueta con importe de un producto sin precio: no se puede saber el peso', () => {
    const result = resolveScaleScan(label(123, 100000), ON, catalog(weightProduct({ scalePlu: 123, price: 0 })))
    expect(result).toMatchObject({ kind: 'error' })
  })

  it('etiquetas que la balanza imprime y no se interpretan (venta por unidad, sumatoria)', () => {
    const result = resolveScaleScan(withCheckDigit('210123000003'), ON, catalog(queso))
    expect(result).toEqual({ kind: 'error', message: 'Etiqueta de venta por unidad: el POS todavía no la lee. Ingresá el producto por su código.' })
  })

  it('respeta el stock, contando lo que ya está en el carrito', () => {
    const poco = weightProduct({ scalePlu: 123, stock: 0.6 })
    expect(resolveScaleScan(label(123, 420000), ON, catalog(poco)).kind).toBe('line')
    const cart = [weightLine(poco, 0.2)]
    const result = resolveScaleScan(label(123, 420000), ON, catalog(poco), cart) // 0,525 > 0,4
    expect(result).toMatchObject({ kind: 'error' })
    expect((result as { message: string }).message).toContain('0,400 kg')
  })
})
