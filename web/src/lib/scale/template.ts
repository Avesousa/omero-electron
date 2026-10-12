import { isValidEan13 } from './ean13'
import type { ScaleReading } from './types'

/**
 * Plantillas de código de barras de balanza: 12 caracteres (el 13.º del EAN es el verificador), con la misma
 * notación que usa el menú de las balanzas Systel:
 *
 *   0-9   dígito fijo (el encabezado que identifica el tipo de etiqueta)
 *   P     código de PLU
 *   I     importe total
 *   C     cantidad (peso)
 *   otra  campo que se ignora (S sección, B número de balanza, A artículos…)
 *
 * Ejemplo de fábrica: `20PPPPIIIIII` = encabezado 20 + PLU de 4 dígitos + importe de 6.
 */
export const TEMPLATE_LENGTH = 12

export interface TemplateDecimals {
  amountDecimals: number
  weightDecimals: number
}

/** Mayúsculas y sin espacios. */
export function normalizeTemplate(template: string): string {
  return template.trim().toUpperCase()
}

/** Encabezado fijo con el que empieza una plantilla ("20" en `20PPPPIIIIII`). */
export function templatePrefix(template: string): string {
  return /^\d*/.exec(normalizeTemplate(template))![0]
}

/** Por qué una plantilla no sirve, o `null` si es válida. */
export function templateProblem(template: string): string | null {
  const t = normalizeTemplate(template)
  if (t.length !== TEMPLATE_LENGTH) return `Tiene que tener ${TEMPLATE_LENGTH} caracteres (tiene ${t.length})`
  if (!/^[0-9A-Z]+$/.test(t)) return 'Solo admite dígitos y letras'
  if (templatePrefix(t).length === 0) return 'Tiene que empezar con el encabezado numérico (por ejemplo 20)'
  if (!t.includes('P')) return 'Falta el código de PLU (letra P)'
  if (!t.includes('I') && !t.includes('C')) return 'Falta el importe (letra I) o la cantidad (letra C)'
  for (const field of ['P', 'I', 'C']) {
    const first = t.indexOf(field)
    const last = t.lastIndexOf(field)
    if (first >= 0 && t.slice(first, last + 1).replace(new RegExp(field, 'g'), '') !== '') {
      return `Las letras ${field} tienen que ir juntas`
    }
  }
  return null
}

/**
 * Interpreta un EAN-13 con una plantilla. `null` si el código no es un EAN-13 válido, si la plantilla no sirve o
 * si los dígitos fijos no coinciden.
 */
export function parseWithTemplate(code: string, template: string, decimals: TemplateDecimals): ScaleReading | null {
  const t = normalizeTemplate(template)
  if (templateProblem(t) !== null || !isValidEan13(code)) return null

  let plu = ''
  let amount = ''
  let weight = ''
  for (let i = 0; i < TEMPLATE_LENGTH; i++) {
    const symbol = t[i]
    const digit = code[i]
    if (symbol >= '0' && symbol <= '9') {
      if (symbol !== digit) return null
    } else if (symbol === 'P') plu += digit
    else if (symbol === 'I') amount += digit
    else if (symbol === 'C') weight += digit
  }

  const reading: ScaleReading = { plu: Number(plu), template: t }
  if (amount !== '') reading.amount = Number(amount) / 10 ** decimals.amountDecimals
  if (weight !== '') reading.weightKg = Number(weight) / 10 ** decimals.weightDecimals
  return reading
}
