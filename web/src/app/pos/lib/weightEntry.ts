/**
 * Panel de peso del POS: estado y teclas. Un producto con peso no entra directo al carrito: el cajero tiene que
 * cargar los kg (o los gramos) y, si el producto también se vende por unidad, puede cargar unidades.
 *
 * Todo con el teclado numérico, como el resto del POS:
 *   0-9 .      escribir            *   alternar kg ↔ g
 *   Enter / +  agregar             /   alternar Kg ↔ Unidades (solo productos por unidad y peso)
 *   ⌫          borrar              Esc cancelar
 *
 * Lógica pura (sin React) para poder probar cada tecla.
 */
import { lineTotal, roundKg, type QuantityUnit } from '@/lib/quantity'
import type { Product } from '../types'
import { isMixedProduct, unitPriceOfProduct } from './cartLines'

/** A partir de este peso se pide una segunda confirmación: casi siempre son gramos tipeados en modo kg. */
export const LARGE_WEIGHT_KG = 100

export interface WeightEntryState {
  product: Product
  /** Qué se está cargando: peso (KG) o unidades (UNIT, solo productos por unidad y peso). */
  tab: QuantityUnit
  /** En la pestaña de peso: el número tipeado son gramos. */
  gramsMode: boolean
  input: string
  /** Ya se avisó que el peso es muy grande; el próximo Enter lo agrega. */
  largeWeightWarning: boolean
  /** Corrigiendo una pesada que ya está en el carrito. */
  editLineId?: string
  /** Peso actual de la línea que se corrige (solo informativo). */
  currentWeightKg?: number
}

export interface WeightPrefs {
  gramsMode: boolean
  tab: QuantityUnit
}

export type WeightEntryResult =
  | { kind: 'empty' }
  | { kind: 'warn-large'; weightKg: number }
  | { kind: 'no-stock'; available: number }
  | { kind: 'ok'; unit: QuantityUnit; quantity: number }

const GRAMS_KEY = 'pos_weight_grams'
const tabKey = (code: string) => `pos_mixed_tab_${code}`

/** Última unidad usada en esta caja (kg/g) y, por producto mixto, la última pestaña. Primera vez: kg y pestaña Kg. */
export function loadWeightPrefs(product: Product): WeightPrefs {
  let gramsMode = false
  let tab: QuantityUnit = 'KG'
  try {
    gramsMode = localStorage.getItem(GRAMS_KEY) === '1'
    if (isMixedProduct(product) && localStorage.getItem(tabKey(product.code)) === 'UNIT') tab = 'UNIT'
  } catch {
    /* sin localStorage: valores por defecto */
  }
  return { gramsMode, tab }
}

export function saveWeightPrefs(state: WeightEntryState): void {
  try {
    if (state.tab === 'KG') localStorage.setItem(GRAMS_KEY, state.gramsMode ? '1' : '0')
    if (isMixedProduct(state.product)) localStorage.setItem(tabKey(state.product.code), state.tab)
  } catch {
    /* las preferencias son una comodidad: si no se pueden guardar no pasa nada */
  }
}

export function openWeightEntry(
  product: Product,
  prefs: WeightPrefs,
  edit?: { lineId: string; weightKg: number },
): WeightEntryState {
  return {
    product,
    // Corregir una pesada siempre es en la pestaña de peso; un producto solo por peso no tiene pestaña de unidades.
    tab: edit || !isMixedProduct(product) ? 'KG' : prefs.tab,
    gramsMode: prefs.gramsMode,
    input: '',
    largeWeightWarning: false,
    ...(edit ? { editLineId: edit.lineId, currentWeightKg: edit.weightKg } : {}),
  }
}

function appendDigit(state: WeightEntryState, digit: string): string {
  const { input } = state
  const wholeNumber = state.tab === 'UNIT' || state.gramsMode
  if (wholeNumber) {
    const next = input === '0' ? digit : input + digit
    return next.length > (state.tab === 'UNIT' ? 4 : 6) ? input : next
  }
  const dot = input.indexOf('.')
  if (dot >= 0) return input.length - dot - 1 >= 3 ? input : input + digit // hasta gramos
  const next = input === '0' ? digit : input + digit
  return next.length > 4 ? input : next
}

/**
 * Aplica una tecla. Devuelve el estado nuevo, o `'confirm'` / `'cancel'` cuando la tecla pide agregar o salir.
 * Cualquier tecla que cambia lo cargado descarta el aviso de peso grande.
 */
export function weightEntryKey(state: WeightEntryState, key: string): WeightEntryState | 'confirm' | 'cancel' {
  if (key === 'Enter' || key === '+') return 'confirm'
  if (key === 'Escape') return 'cancel'

  if (/^\d$/.test(key)) return { ...state, input: appendDigit(state, key), largeWeightWarning: false }
  if (key === 'Backspace') return { ...state, input: state.input.slice(0, -1), largeWeightWarning: false }
  if (key === '.' || key === ',') {
    if (state.tab !== 'KG' || state.gramsMode || state.input.includes('.')) return state
    return { ...state, input: (state.input === '' ? '0' : state.input) + '.', largeWeightWarning: false }
  }
  if (key === '*') {
    if (state.tab !== 'KG') return state
    return { ...state, gramsMode: !state.gramsMode, input: '', largeWeightWarning: false }
  }
  if (key === '/') {
    if (!isMixedProduct(state.product) || state.editLineId) return state
    return { ...state, tab: state.tab === 'KG' ? 'UNIT' : 'KG', input: '', largeWeightWarning: false }
  }
  return state
}

/** Lo cargado hasta ahora: kg (ya convertidos si se tipearon gramos) o unidades. `null` si todavía no hay nada válido. */
export function weightEntryValue(state: WeightEntryState): { unit: QuantityUnit; quantity: number } | null {
  const typed = Number(state.input)
  if (state.input === '' || !Number.isFinite(typed) || typed <= 0) return null
  if (state.tab === 'UNIT') return { unit: 'UNIT', quantity: Math.trunc(typed) }
  const quantity = roundKg(state.gramsMode ? typed / 1000 : typed)
  return quantity > 0 ? { unit: 'KG', quantity } : null
}

/** Precio por unidad de venta de lo que se está cargando (por kg o por pieza). */
export function weightEntryPrice(state: WeightEntryState): number {
  return state.tab === 'KG' ? state.product.price || 0 : unitPriceOfProduct(state.product)
}

/** Importe de lo cargado hasta ahora (0 si todavía no hay nada). */
export function weightEntrySubtotal(state: WeightEntryState): number {
  const value = weightEntryValue(state)
  return value ? lineTotal(value.quantity, weightEntryPrice(state)) : 0
}

/** Lo que la carga descuenta del stock, en kg. */
function stockNeeded(state: WeightEntryState, value: { unit: QuantityUnit; quantity: number }): number {
  if (value.unit === 'KG') return value.quantity
  return roundKg(value.quantity * (state.product.unitWeightKg || 0))
}

/**
 * Qué hacer al confirmar. `availableKg` = stock del producto menos lo que ya hay en el carrito (sin contar la línea
 * que se está corrigiendo).
 */
export function resolveWeightEntry(state: WeightEntryState, availableKg: number): WeightEntryResult {
  const value = weightEntryValue(state)
  if (!value) return { kind: 'empty' }
  if (value.unit === 'KG' && value.quantity >= LARGE_WEIGHT_KG && !state.largeWeightWarning) {
    return { kind: 'warn-large', weightKg: value.quantity }
  }
  if (stockNeeded(state, value) > availableKg) return { kind: 'no-stock', available: Math.max(0, availableKg) }
  return { kind: 'ok', ...value }
}
