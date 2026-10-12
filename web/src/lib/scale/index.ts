import { lineTotal, weightFromAmount } from '../quantity'
import { isValidEan13 } from './ean13'
import { DEFAULT_SCALE_BRAND, getScaleProfile, SCALE_PROFILES } from './registry'
import { normalizeTemplate, parseWithTemplate, templateProblem } from './template'
import type { ScaleConfig, ScaleParseResult, ScaleReading } from './types'

export * from './types'
export { ean13CheckDigit, isValidEan13, withCheckDigit } from './ean13'
export { normalizeTemplate, parseWithTemplate, templatePrefix, templateProblem, TEMPLATE_LENGTH } from './template'
export { DEFAULT_SCALE_BRAND, getScaleProfile, SCALE_PROFILES } from './registry'

/** Claves de la configuración del negocio que arman un {@link ScaleConfig}. */
export const SCALE_CONFIG_KEYS = [
  'scale_enabled',
  'scale_brand',
  'scale_barcode_templates',
  'scale_amount_decimals',
  'scale_weight_decimals',
] as const
export type ScaleConfigKey = (typeof SCALE_CONFIG_KEYS)[number]

/** Balanza apagada, con los valores de fábrica de la marca por defecto. */
export const DEFAULT_SCALE_CONFIG: ScaleConfig = {
  enabled: false,
  brand: DEFAULT_SCALE_BRAND,
  templates: [...SCALE_PROFILES[DEFAULT_SCALE_BRAND].defaultTemplates],
  amountDecimals: SCALE_PROFILES[DEFAULT_SCALE_BRAND].defaultAmountDecimals,
  weightDecimals: SCALE_PROFILES[DEFAULT_SCALE_BRAND].defaultWeightDecimals,
}

function decimalsFrom(value: string | null | undefined, fallback: number): number {
  const n = Number((value ?? '').trim())
  return (value ?? '').trim() !== '' && Number.isInteger(n) && n >= 0 && n <= 4 ? n : fallback
}

/** Separa "20PPPPIIIIII, 21PPPP..." en plantillas normalizadas (descarta las vacías). */
export function splitTemplates(value: string | null | undefined): string[] {
  return (value ?? '').split(',').map(normalizeTemplate).filter(t => t !== '')
}

/**
 * Arma la configuración a partir de los valores guardados (texto). Lo que falta o no se entiende toma el valor de
 * fábrica de la marca, así una clave mal cargada nunca deja al POS sin poder leer.
 */
export function scaleConfigFromEntries(entries: Partial<Record<ScaleConfigKey, string | null | undefined>>): ScaleConfig {
  const brand = (entries.scale_brand ?? '').trim().toUpperCase() || DEFAULT_SCALE_BRAND
  const profile = getScaleProfile(brand) ?? SCALE_PROFILES[DEFAULT_SCALE_BRAND]
  const templates = splitTemplates(entries.scale_barcode_templates).filter(t => templateProblem(t) === null)
  return {
    enabled: (entries.scale_enabled ?? '').trim().toLowerCase() === 'true',
    brand,
    templates: templates.length > 0 ? templates : [...profile.defaultTemplates],
    amountDecimals: decimalsFrom(entries.scale_amount_decimals, profile.defaultAmountDecimals),
    weightDecimals: decimalsFrom(entries.scale_weight_decimals, profile.defaultWeightDecimals),
  }
}

/** ¿Puede ser una etiqueta de balanza? (13 dígitos; sirve para decidir si vale la pena intentar interpretarla). */
export function looksLikeScaleBarcode(code: string): boolean {
  return /^\d{13}$/.test(code)
}

/**
 * Interpreta un código leído por el lector. Devuelve la lectura, un aviso de "etiqueta no soportada", o `null` si
 * no es una etiqueta de la balanza (y entonces se busca como un código de barras común).
 */
export function parseScaleBarcode(code: string, config: ScaleConfig): ScaleParseResult | null {
  if (!config.enabled || !looksLikeScaleBarcode(code)) return null
  const profile = getScaleProfile(config.brand)

  let reading: ScaleReading | null = null
  if (profile?.parse) {
    reading = profile.parse(code, config)
  } else {
    for (const template of config.templates) {
      reading = parseWithTemplate(code, template, config)
      if (reading) break
    }
  }
  if (reading) return { kind: 'reading', reading }

  if (isValidEan13(code) && profile?.unsupportedPrefixes) {
    for (const [prefix, reason] of Object.entries(profile.unsupportedPrefixes)) {
      if (code.startsWith(prefix)) return { kind: 'unsupported', reason }
    }
  }
  return null
}

/** Peso e importe de la línea que corresponde a una lectura, para un producto con ese precio por kg. */
export interface ScaleLine {
  weightKg: number
  total: number
  /** El importe vino impreso en la etiqueta: se cobra ese, no el que da peso × precio. */
  totalFromLabel: boolean
}

/**
 * Convierte la lectura en la línea a cobrar. Con importe en la etiqueta se cobra ese importe (y el peso, si no vino,
 * se calcula para descontar stock); con solo peso, peso × precio. `null` si no alcanza para armar la línea.
 */
export function scaleLineFor(reading: ScaleReading, pricePerKg: number | null | undefined): ScaleLine | null {
  const price = pricePerKg ?? 0
  if (reading.amount != null && reading.amount > 0) {
    const weightKg = reading.weightKg != null && reading.weightKg > 0 ? reading.weightKg : weightFromAmount(reading.amount, price)
    if (weightKg == null || !(weightKg > 0)) return null
    return { weightKg, total: reading.amount, totalFromLabel: true }
  }
  if (reading.weightKg != null && reading.weightKg > 0 && price > 0) {
    return { weightKg: reading.weightKg, total: lineTotal(reading.weightKg, price), totalFromLabel: false }
  }
  return null
}
