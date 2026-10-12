import type { ScaleProfile } from '../types'

/**
 * Balanzas Systel (Cuora, Croma, Clipse). De fábrica el código de barras usa el encabezado `20` para los artículos
 * pesables, `21` para la venta por unidad y `22` para la sumatoria de artículos; el ejemplo del manual para los
 * pesables es `20PPPPIIIIII` (PLU de 4 dígitos + importe de 6). El formato se cambia desde el menú de la balanza
 * (Configuración → Código de barras), por eso acá es solo el valor inicial.
 */
export const SYSTEL: ScaleProfile = {
  id: 'SYSTEL',
  label: 'Systel',
  defaultTemplates: ['20PPPPIIIIII'],
  defaultAmountDecimals: 2,
  defaultWeightDecimals: 3,
  unsupportedPrefixes: {
    '21': 'venta por unidad',
    '22': 'sumatoria de artículos',
  },
  help: 'En la balanza: Menú → Configuración → Código de barras. Copiá acá la misma secuencia que figura para "artículos pesables".',
}
