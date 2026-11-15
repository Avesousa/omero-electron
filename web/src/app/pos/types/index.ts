// Types for POS application
import type { QuantityUnit, SaleFormat } from '@/lib/quantity'
import type { PaymentMethod as PaymentMethodConfig } from '@/shared/constants/paymentMethods'
import type { PaymentLine } from '../utils/payments'
import type { Customer } from '@/shared/types/credit'

export interface Product {
  id: string
  name: string
  code: string
  barcode?: string
  /** Precio de venta: por unidad, o por kg si el producto lleva peso (`saleFormat` GRAMS o MIXED). */
  price: number
  /** En unidades, o en kg si el producto lleva peso. */
  stock: number
  costPrice?: number
  category?: any
  /** UNIT (por unidad, el default), GRAMS (por peso) o MIXED (por unidad y por peso). */
  saleFormat?: SaleFormat
  /** Equivalencia: kg por unidad (productos MIXED). */
  unitWeightKg?: number | null
  /** MIXED: precio de una unidad, ya resuelto por el backend (fijado a mano o derivado del precio por kg). */
  unitPrice?: number | null
  /** Código del producto en la balanza (PLU de la etiqueta). */
  scalePlu?: number | null
}

export interface CartItem {
  id: string
  code: string
  name: string
  /** Precio por unidad de venta: por pieza en las líneas por unidad, por kg en las líneas por peso. */
  price: number
  /** Unidades, o kg si `saleUnit` es KG. */
  quantity: number
  total: number
  originalPrice?: number // Precio original antes de promoción
  promotionId?: string // ID de la promoción aplicada
  promotionName?: string // Nombre de la promoción aplicada
  /** UNIT (default) | KG. Las líneas KG son una pesada cada una: no se acumulan ni entran en promociones. */
  saleUnit?: QuantityUnit
  /** Producto por unidad y peso vendido por unidad: kg que descuenta del stock cada unidad. */
  stockPerUnit?: number
  /** El importe vino impreso en la etiqueta de la balanza: se cobra ese, no cantidad × precio. */
  fixedTotal?: boolean
}

/**
 * Línea PENDIENTE de crédito cargada al proceso de venta: NO es un producto nuevo (no descuenta stock ni viaja como
 * item de venta). Se muestra con su estado y la deuda actual; se cobra con `POST /api/credit/collect`.
 */
export interface CreditCartItem {
  kind: 'CREDIT_LINE'
  saleItemId: string
  saleId: number
  soldAt: string
  code: string
  name: string
  quantity: number
  /** Deuda actual de la línea (precios vigentes). */
  debt: number
  status: 'PENDING' | 'PAID'
}

export interface Sale {
  id: number  // Changed from string to number for autoincrement
  total: number
  cashAmount: number
  mpAmount: number
  change?: number
  createdAt: Date
  items: CartItem[]
}

/** Medio de pago configurado por el negocio (Configuración → Medios de pago en el admin). */
export type PaymentMethod = PaymentMethodConfig

export type InputMode = 'code' | 'quantity' | 'payment'

export type NotificationType = 'success' | 'error' | 'info' | 'offline_saved'

export interface Notification {
  message: string
  type: NotificationType
}

export interface PaymentState {
  showPaymentModal: boolean
  paymentMethod: PaymentMethod | null
  paymentInput: string
  isProcessingPayment: boolean
  remainingAmount: number
  /** Pagos ya registrados en este cobro (uno por medio). */
  payments: PaymentLine[]
  change: number
  showingChange: boolean
  /** Total de la venta NUEVA (sin la deuda que se cobra). `remainingAmount` incluye también lo que se cobra de deuda. */
  saleTotal: number
  /** Deuda del cliente cargada para cobrar (0 = no hay cobro de deuda). */
  collectDebt: number
  /** Monto de deuda que se cobra en esta operación (≤ collectDebt). */
  collectAmount: number
  /** Paso previo al cobro: el cajero elige cuánto de la deuda cobra (Enter sin escribir = toda). */
  collectStep: boolean
  collectInput: string
  /** Cliente al que se le fía (medio Crédito) o del que se cobra la deuda. */
  creditCustomer: Customer | null
}

export interface DeleteModalState {
  isOpen: boolean
  deleteModalInput: string
  showClearConfirmation: boolean
}

export interface PaymentNotification {
  id: string
  amount: number
  method: string
  paymentType: string
  receivedAt: string
}

export interface MPStatusEvent {
  connected: boolean
  lastChecked: string
}