/**
 * Lectura de una etiqueta de balanza en el POS: de los 13 dígitos del lector a la línea que hay que cobrar.
 * Lógica pura; la página solo decide qué hacer con el resultado.
 */
import { formatStock, roundKg } from '@/lib/quantity'
import { parseScaleBarcode, scaleLineFor, type ScaleConfig } from '@/lib/scale'
import type { CartItem, Product } from '../types'
import { needsWeightEntry, stockInCart, toQuantityProduct } from './cartLines'

export type ScaleScanResult =
  /** No es una etiqueta de la balanza: se busca como un código de barras común. */
  | { kind: 'not-scale' }
  /** Es una etiqueta, pero no se puede cobrar: `message` es lo que ve el cajero. */
  | { kind: 'error'; message: string }
  /** `labelTotal` solo si el importe vino impreso en la etiqueta (se cobra ese importe). */
  | { kind: 'line'; product: Product; weightKg: number; labelTotal?: number }

export function resolveScaleScan(
  code: string,
  config: ScaleConfig,
  findByPlu: (plu: number) => Product | null,
  cart: CartItem[] = [],
): ScaleScanResult {
  const parsed = parseScaleBarcode(code, config)
  if (!parsed) return { kind: 'not-scale' }
  if (parsed.kind === 'unsupported') {
    return { kind: 'error', message: `Etiqueta de ${parsed.reason}: el POS todavía no la lee. Ingresá el producto por su código.` }
  }

  const { reading } = parsed
  const product = findByPlu(reading.plu)
  if (!product) {
    return { kind: 'error', message: `Etiqueta de balanza: no hay ningún producto con el código de balanza ${reading.plu}` }
  }
  if (!needsWeightEntry(product)) {
    return { kind: 'error', message: `${product.name} se vende por unidad: no se puede cobrar con una etiqueta de peso` }
  }
  const line = scaleLineFor(reading, product.price)
  if (!line) return { kind: 'error', message: `No se pudo leer el peso de la etiqueta de ${product.name}` }

  const available = roundKg(product.stock - stockInCart(cart, product.code))
  if (line.weightKg > available) {
    return {
      kind: 'error',
      message: `Stock insuficiente de ${product.name}. Disponible: ${formatStock(toQuantityProduct(product), Math.max(0, available))}`,
    }
  }
  return {
    kind: 'line',
    product,
    weightKg: line.weightKg,
    ...(line.totalFromLabel ? { labelTotal: line.total } : {}),
  }
}
