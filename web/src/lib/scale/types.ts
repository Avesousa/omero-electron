/**
 * Lectura de etiquetas de balanza. Las balanzas etiquetadoras imprimen un EAN-13 "de uso interno" (prefijo 20–29)
 * que lleva el código del producto en la balanza (PLU) y el peso o el importe de esa pesada.
 *
 * Cada marca es un {@link ScaleProfile} con sus valores de fábrica; el formato concreto es una plantilla
 * configurable por negocio (ver `template.ts`). Para sumar una marca: un archivo en `profiles/` + `registry.ts`.
 */

/** Marcas con perfil propio. */
export type ScaleBrandId = 'SYSTEL'

/** Configuración de balanza de un negocio (claves `scale_*` de la configuración del negocio). */
export interface ScaleConfig {
  enabled: boolean
  brand: string
  /** Plantillas de 12 caracteres; se prueban en orden. */
  templates: string[]
  /** Decimales del importe embebido (campo `I`). */
  amountDecimals: number
  /** Decimales del peso embebido (campo `C`): 3 = gramos. */
  weightDecimals: number
}

/** Lo que dice una etiqueta. Trae peso, importe o ambos según la plantilla. */
export interface ScaleReading {
  /** Código del producto en la balanza. */
  plu: number
  weightKg?: number
  amount?: number
  /** Plantilla que la interpretó. */
  template: string
}

export type ScaleParseResult =
  | { kind: 'reading'; reading: ScaleReading }
  /** Es una etiqueta de la balanza, pero de un tipo que no se interpreta (venta por unidad, sumatoria). */
  | { kind: 'unsupported'; reason: string }

export interface ScaleProfile {
  id: ScaleBrandId
  label: string
  /** Plantillas con las que la balanza sale de fábrica. */
  defaultTemplates: string[]
  defaultAmountDecimals: number
  defaultWeightDecimals: number
  /** Prefijos de etiquetas que la balanza imprime y este sistema no interpreta → motivo para avisarle al cajero. */
  unsupportedPrefixes?: Record<string, string>
  /** Dónde se configura el código de barras en la balanza (para la pantalla de configuración). */
  help: string
  /** Solo si la balanza no se puede describir con una plantilla. */
  parse?: (code: string, config: ScaleConfig) => ScaleReading | null
}
