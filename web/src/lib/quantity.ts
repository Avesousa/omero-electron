/**
 * Cantidades y unidades de venta. Espejo de `com.omero.service.QuantityMath` y `Product.effectiveUnitPrice()` del
 * backend: las tres copias (backend, admin y POS) se prueban contra los mismos casos (`__fixtures__/quantity-cases.json`).
 *
 *   Formato   Stock / costo / precio de venta   Se vende
 *   UNIT      por unidad                        por unidad
 *   GRAMS     por kg                            por kg          (el nombre es histórico: la unidad es el kg)
 *   MIXED     por kg                            por unidad o por kg (la unidad pesa `unitWeightKg`)
 *
 * Todo el cálculo se hace en enteros (gramos y centavos) para no arrastrar errores de punto flotante.
 */
import { formatDecimal, formatNumber } from './money'

export type SaleFormat = 'UNIT' | 'GRAMS' | 'MIXED'
export type QuantityUnit = 'UNIT' | 'KG'

/** Lo que el cálculo necesita saber de un producto (lo cumple tanto el producto del API como el del POS). */
export interface QuantityProduct {
  name?: string
  saleFormat?: string | null
  /** Precio de venta: por unidad en UNIT, por kg en GRAMS y MIXED. */
  sellingPrice?: number | null
  /** Costo: por unidad en UNIT, por kg en GRAMS y MIXED. */
  costPrice?: number | null
  /** Equivalencia: kg por unidad/bulto. */
  unitWeightKg?: number | null
  /** MIXED: precio por unidad fijado a mano (null = derivado). */
  unitPrice?: number | null
  /** Múltiplo de redondeo de precios (0 = sin redondeo). */
  rounding?: number | null
}

export const SALE_FORMAT_LABELS: Record<SaleFormat, string> = {
  UNIT: 'Por unidad',
  GRAMS: 'Por peso',
  MIXED: 'Por unidad y peso',
}

export function saleFormatOf(product: QuantityProduct): SaleFormat {
  return product.saleFormat === 'GRAMS' || product.saleFormat === 'MIXED' ? product.saleFormat : 'UNIT'
}

/** El producto lleva stock, costo y precio en kg. */
export function tracksWeight(product: QuantityProduct): boolean {
  return saleFormatOf(product) !== 'UNIT'
}

export function isMixed(product: QuantityProduct): boolean {
  return saleFormatOf(product) === 'MIXED'
}

/** Unidad con la que se vende un producto cuando no se elige otra. */
export function defaultUnit(product: QuantityProduct): QuantityUnit {
  return saleFormatOf(product) === 'GRAMS' ? 'KG' : 'UNIT'
}

export function allowsUnit(product: QuantityProduct, unit: QuantityUnit): boolean {
  return isMixed(product) || unit === defaultUnit(product)
}

// ── Enteros ──────────────────────────────────────────────────────────────────

/**
 * Redondeo a entero con mitad hacia arriba. `toPrecision(15)` descarta el ruido binario antes de redondear:
 * 1.005 × 100 da 100.49999999999999 y sin esto quedaría en 100.
 */
function roundHalfUp(value: number): number {
  return Math.round(Number(value.toPrecision(15)))
}

/** kg → gramos enteros. */
export function toGrams(kg: number): number {
  return roundHalfUp(kg * 1000)
}

/** pesos → centavos enteros. */
export function toCents(amount: number): number {
  return roundHalfUp(amount * 100)
}

/** Redondeo a centavos (mitad hacia arriba). */
export function roundMoney(amount: number): number {
  return toCents(amount) / 100
}

/** Redondeo a gramos. */
export function roundKg(kg: number): number {
  return toGrams(kg) / 1000
}

/** Cantidad de decimales significativos de un número (hasta 6). */
function decimalsOf(value: number): number {
  const text = value.toFixed(6).replace(/0+$/, '')
  const dot = text.indexOf('.')
  return dot < 0 ? 0 : text.length - dot - 1
}

/** Techo al múltiplo de `step` (redondeo de precios); sin paso, a centavos. Recibe centavos × milésimas. */
function roundUpScaled(centsTimesMilli: number, step: number): number {
  if (step > 0) return Math.ceil(centsTimesMilli / (step * 100 * 1000)) * step
  return roundHalfUp(centsTimesMilli / 1000) / 100
}

// ── Precios ──────────────────────────────────────────────────────────────────

/**
 * Precio de UNA unidad: el precio de venta en UNIT; en MIXED el fijado a mano o, si no hay, el precio por kg por el
 * peso de la unidad (con el redondeo del producto). `null` en GRAMS: no se vende por unidad.
 */
export function unitPriceOf(product: QuantityProduct): number | null {
  const format = saleFormatOf(product)
  if (format === 'UNIT') return product.sellingPrice ?? null
  if (format === 'GRAMS') return null
  if (product.unitPrice != null && product.unitPrice > 0) return roundMoney(product.unitPrice)
  if (product.sellingPrice == null || !product.unitWeightKg) return null
  return roundUpScaled(toCents(product.sellingPrice) * toGrams(product.unitWeightKg), product.rounding ?? 0)
}

/** Precio por unidad de venta de una línea: por kg en las líneas por peso, por pieza en las líneas por unidad. */
export function priceFor(product: QuantityProduct, unit: QuantityUnit): number | null {
  return unit === 'KG' ? (product.sellingPrice ?? null) : unitPriceOf(product)
}

/** Importe de una línea: cantidad × precio, a centavos. */
export function lineTotal(quantity: number, unitPrice: number): number {
  return roundHalfUp((toGrams(quantity) * toCents(unitPrice)) / 1000) / 100
}

/** Peso que corresponde a un importe (etiquetas de balanza con importe embebido), a gramos. */
export function weightFromAmount(amount: number, pricePerKg: number): number | null {
  if (!(pricePerKg > 0) || !(amount > 0)) return null
  return roundHalfUp((toCents(amount) * 1000) / toCents(pricePerKg)) / 1000
}

// ── Stock y costo ────────────────────────────────────────────────────────────

/** Cuánto descuenta la línea del stock, en la unidad base del producto (kg si lleva peso). */
export function stockQuantity(product: QuantityProduct, unit: QuantityUnit, quantity: number): number {
  if (unit === 'UNIT' && isMixed(product) && product.unitWeightKg) {
    return roundHalfUp(quantity * toGrams(product.unitWeightKg)) / 1000
  }
  return roundKg(quantity)
}

/** Costo vigente del producto por unidad de venta (0 si no tiene costo), con 4 decimales. */
export function unitCostFor(product: QuantityProduct, unit: QuantityUnit): number {
  const cost = product.costPrice ?? 0
  if (unit === 'UNIT' && isMixed(product) && product.unitWeightKg) {
    return roundHalfUp((roundHalfUp(cost * 10000) * toGrams(product.unitWeightKg)) / 1000) / 10000
  }
  return roundHalfUp(cost * 10000) / 10000
}

/** Unidades enteras que equivalen a un stock en kg (para mostrar "≈ N u"). */
export function approxUnits(product: QuantityProduct, stockKg: number): number | null {
  if (!isMixed(product) || !product.unitWeightKg) return null
  return Math.floor(toGrams(stockKg) / toGrams(product.unitWeightKg))
}

// ── Validación ───────────────────────────────────────────────────────────────

/** Por qué la cantidad no es válida para ese producto y unidad, o `null` si lo es. */
export function quantityProblem(product: QuantityProduct, unit: QuantityUnit, quantity: number): string | null {
  const name = product.name ? `"${product.name}"` : 'El producto'
  if (!Number.isFinite(quantity) || quantity <= 0) return 'La cantidad debe ser mayor a 0'
  if (!allowsUnit(product, unit)) {
    return unit === 'KG' ? `${name} se vende por unidad, no por peso` : `${name} se vende por peso, no por unidad`
  }
  if (unit === 'UNIT' && !Number.isInteger(quantity)) return 'La cantidad debe ser un número entero de unidades'
  if (unit === 'KG' && decimalsOf(quantity) > 3) return 'El peso admite hasta 3 decimales (gramos)'
  if (unit === 'UNIT' && isMixed(product) && !(product.unitWeightKg && product.unitWeightKg > 0)) {
    return `${name} no tiene definido el peso por unidad`
  }
  return null
}

// ── Formato y parseo (separadores de la región del negocio, ver lib/money) ──────

const kgFormatter = { format: (n: number) => formatDecimal(n, 3) }
const unitFormatter = { format: (n: number) => formatNumber(n, 3) }

/** "0,350 kg" */
export function formatKg(kg: number): string {
  return `${kgFormatter.format(kg)} kg`
}

/** Cantidad de una línea con su unidad: "3" o "0,350 kg". */
export function formatQuantity(quantity: number, unit: QuantityUnit): string {
  return unit === 'KG' ? formatKg(quantity) : unitFormatter.format(quantity)
}

/** Stock con su unidad: "48 u", "12,400 kg" o "12,400 kg · ≈ 3 u" en productos por unidad y peso. */
export function formatStock(product: QuantityProduct, stock: number): string {
  if (!tracksWeight(product)) return `${unitFormatter.format(stock)} u`
  const units = approxUnits(product, stock)
  return units == null ? formatKg(stock) : `${formatKg(stock)} · ≈ ${unitFormatter.format(units)} u`
}

/** Sufijo de unidad de un precio: "/kg" o "/u". */
export function priceSuffix(product: QuantityProduct): string {
  return tracksWeight(product) ? '/kg' : '/u'
}

/**
 * Número escrito por una persona, con coma o punto decimal ("0,35", "0.35", "1.234,5"). `null` si no es un número.
 * Si hay coma y punto, el último es el decimal.
 */
export function parseDecimal(text: string | null | undefined): number | null {
  if (text == null) return null
  let s = text.trim().replace(/\s/g, '')
  if (s === '') return null
  const comma = s.lastIndexOf(',')
  const dot = s.lastIndexOf('.')
  if (comma >= 0 && dot >= 0) s = comma > dot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  else if (comma >= 0) s = s.replace(',', '.')
  if (!/^-?\d*\.?\d+$|^-?\d+\.$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
