/**
 * Medios de pago configurables (Configuración → Medios de pago, cobro del POS).
 * Espejo de `PaymentMethodColors` / `PaymentMethodKind` de omero-backend y copiado a mano en omero-electron
 * (`web/src/shared/constants/paymentMethods.ts`): mantener los tres sincronizados.
 */

/** CASH = Efectivo, MERCADOPAGO = medio especial, CUSTOM = los agrega el usuario, CREDIT = reservado (fase 2, aún sin usar). */
export type PaymentMethodKind = 'CASH' | 'MERCADOPAGO' | 'CUSTOM' | 'CREDIT'

export const MAX_PAYMENT_METHODS = 6
export const PAYMENT_SHORTCUT_KEYS = [1, 2, 3, 4, 5, 6] as const

export interface PaymentColor {
  /** Clave que se guarda en el backend (`payment_methods.color`). */
  key: string
  label: string
  /** Color base (fondo/botón) y borde, en hex: se usan con estilos inline (no con clases Tailwind dinámicas). */
  bg: string
  border: string
  /** Texto legible sobre `bg`. */
  text: string
}

export const PAYMENT_COLORS: readonly PaymentColor[] = [
  { key: 'green', label: 'Verde', bg: '#16a34a', border: '#4ade80', text: '#ffffff' },
  { key: 'sky', label: 'Celeste', bg: '#0284c7', border: '#38bdf8', text: '#ffffff' },
  { key: 'blue', label: 'Azul', bg: '#2563eb', border: '#60a5fa', text: '#ffffff' },
  { key: 'violet', label: 'Violeta', bg: '#7c3aed', border: '#a78bfa', text: '#ffffff' },
  { key: 'pink', label: 'Rosa', bg: '#db2777', border: '#f472b6', text: '#ffffff' },
  { key: 'red', label: 'Rojo', bg: '#dc2626', border: '#f87171', text: '#ffffff' },
  { key: 'orange', label: 'Naranja', bg: '#ea580c', border: '#fb923c', text: '#ffffff' },
  { key: 'amber', label: 'Ámbar', bg: '#d97706', border: '#fbbf24', text: '#ffffff' },
  { key: 'teal', label: 'Turquesa', bg: '#0d9488', border: '#2dd4bf', text: '#ffffff' },
  { key: 'slate', label: 'Gris', bg: '#475569', border: '#94a3b8', text: '#ffffff' },
]

export function paymentColor(key: string | null | undefined): PaymentColor {
  return PAYMENT_COLORS.find(c => c.key === key) ?? PAYMENT_COLORS[0]
}

export interface PaymentMethod {
  id: string
  kind: PaymentMethodKind
  name: string
  /** Descripción corta opcional (máx. 100) que el POS muestra bajo el nombre. No es la «descripción del gasto». */
  description?: string | null
  /** Tecla 1-6 del cobro. */
  shortcutKey: number
  color: string
  sortOrder: number
  active: boolean
  isDefault: boolean
  generatesExpense: boolean
  /** Porcentaje (6 = 6 %). */
  expenseRate: number
  expenseCategory: string | null
  expenseDescription: string | null
  /** false para Efectivo y MercadoPago. */
  deletable: boolean
}

/** Pago de una venta ya registrada (importe efectivo, sin vuelto). */
export interface SalePaymentInfo {
  paymentMethodId: string
  name: string
  kind: PaymentMethodKind
  color: string
  amount: number
}

/** Total cobrado por medio de pago en un rango (resumen del día, reportes). */
export interface PaymentBreakdown {
  paymentMethodId: string
  name: string
  kind: PaymentMethodKind
  color: string
  /** Importe BRUTO cobrado con el medio. */
  amount: number
  /** Si el medio (dashboard y resumen del día; opcionales: backends viejos no los traen) genera gasto, el porcentaje, el gasto del rango y el neto (bruto − gasto). */
  generatesExpense?: boolean
  expenseRate?: number
  expenseAmount?: number
  netAmount?: number
}

/**
 * Medios por defecto del POS cuando todavía no se pudieron cargar (web sin conexión): el ID es nulo y el
 * backend los resuelve por `kind` con el formato viejo (cashAmount/mpAmount). Mismas teclas que el POS de siempre.
 */
export const FALLBACK_PAYMENT_METHODS: readonly PaymentMethod[] = [
  { id: 'fallback-mp', kind: 'MERCADOPAGO', name: 'MercadoPago', description: 'QR o transferencia', shortcutKey: 1, color: 'sky', sortOrder: 1, active: true, isDefault: false, generatesExpense: true, expenseRate: 6, expenseCategory: 'Impuestos en las ventas', expenseDescription: 'Impuesto de la venta', deletable: false },
  { id: 'fallback-cash', kind: 'CASH', name: 'Efectivo', description: 'Te calculo el vuelto', shortcutKey: 2, color: 'green', sortOrder: 2, active: true, isDefault: true, generatesExpense: false, expenseRate: 0, expenseCategory: null, expenseDescription: null, deletable: false },
]

export const isFallbackMethod = (m: Pick<PaymentMethod, 'id'>): boolean => m.id.startsWith('fallback-')

/**
 * Subtítulo del medio en el cobro: su descripción configurada. Caches/backends anteriores a la descripción no traen
 * el campo (undefined): ahí Efectivo y MercadoPago conservan los subtítulos de siempre. `null`/"" = sin subtítulo.
 */
export function paymentDescription(m: Pick<PaymentMethod, 'kind' | 'description'>): string | null {
  if (m.description === undefined) {
    return m.kind === 'CASH' ? 'Te calculo el vuelto' : m.kind === 'MERCADOPAGO' ? 'QR o transferencia' : null
  }
  return m.description && m.description.trim() ? m.description.trim() : null
}
