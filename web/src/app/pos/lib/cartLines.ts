/**
 * Líneas del carrito. Dos tipos:
 *   - por unidad (`saleUnit` UNIT o ausente): una línea por producto, la cantidad se acumula;
 *   - por peso (`saleUnit` KG): una línea por pesada, nunca se acumulan ni entran en promociones.
 * Funciones puras: las usa `useCart` y se prueban sin React.
 */
import {
  formatKg, isMixed, lineTotal, roundKg, tracksWeight, unitPriceOf,
  type QuantityProduct,
} from '@/lib/quantity'
import type { CartItem, Product } from '../types'

/** Producto del POS en la forma que espera `lib/quantity` (`price` es el precio de venta: por unidad o por kg). */
export function toQuantityProduct(product: Product): QuantityProduct {
  return {
    name: product.name,
    saleFormat: product.saleFormat,
    sellingPrice: product.price,
    costPrice: product.costPrice,
    unitWeightKg: product.unitWeightKg,
    unitPrice: product.unitPrice,
  }
}

/** El producto se vende (también) por peso: el POS tiene que pedir el peso antes de agregarlo. */
export function needsWeightEntry(product: Product): boolean {
  return tracksWeight(toQuantityProduct(product))
}

export function isMixedProduct(product: Product): boolean {
  return isMixed(toQuantityProduct(product))
}

export function isWeightLine(item: CartItem): boolean {
  return item.saleUnit === 'KG'
}

/** Precio de UNA unidad del producto (para las líneas por unidad). */
export function unitPriceOfProduct(product: Product): number {
  if (!needsWeightEntry(product)) return product.price || 0
  return product.unitPrice ?? unitPriceOf(toQuantityProduct(product)) ?? 0
}

let sequence = 0
/** Id único de línea (dos pesadas en el mismo milisegundo no pueden compartirlo). */
export function newLineId(): string {
  sequence += 1
  return `${Date.now()}-${sequence}`
}

/** Línea por unidad con `quantity` unidades. */
export function unitLine(product: Product, quantity: number, originalPrice?: number): CartItem {
  const price = unitPriceOfProduct(product)
  const line: CartItem = {
    id: newLineId(),
    code: product.code,
    name: product.name,
    price,
    quantity,
    total: lineTotal(quantity, price),
    originalPrice: originalPrice || price,
    saleUnit: 'UNIT',
  }
  // Producto por unidad y peso: cada unidad descuenta su peso del stock (que está en kg).
  if (isMixedProduct(product) && product.unitWeightKg) line.stockPerUnit = product.unitWeightKg
  return line
}

/**
 * Línea por peso. `total` solo cuando el importe vino impreso en la etiqueta de la balanza: en ese caso se cobra
 * ese importe y no se recalcula.
 */
export function weightLine(product: Product, weightKg: number, labelTotal?: number): CartItem {
  const price = product.price || 0
  const quantity = roundKg(weightKg)
  return {
    id: newLineId(),
    code: product.code,
    name: product.name,
    price,
    quantity,
    total: labelTotal != null ? labelTotal : lineTotal(quantity, price),
    originalPrice: price,
    saleUnit: 'KG',
    ...(labelTotal != null ? { fixedTotal: true } : {}),
  }
}

/** Cuánto descuenta la línea del stock, en la unidad base del producto (kg si lleva peso). */
export function lineStockQuantity(item: CartItem): number {
  if (isWeightLine(item)) return roundKg(item.quantity)
  return item.stockPerUnit ? roundKg(item.quantity * item.stockPerUnit) : item.quantity
}

/** Lo que ya hay en el carrito de un producto, en su unidad base. `exceptLineId` excluye la línea que se está editando. */
export function stockInCart(cart: CartItem[], code: string, exceptLineId?: string): number {
  const total = cart
    .filter(item => item.code === code && item.id !== exceptLineId)
    .reduce((sum, item) => sum + lineStockQuantity(item), 0)
  return roundKg(total)
}

/** "0,350 kg" o "3" — la cantidad de la línea como se le muestra al cajero. */
export function lineQuantityLabel(item: CartItem): string {
  return isWeightLine(item) ? formatKg(item.quantity) : String(item.quantity)
}
