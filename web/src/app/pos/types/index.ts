// Types for POS application
import type { QuantityUnit, SaleFormat } from '@/lib/quantity'

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

export interface Sale {
  id: number  // Changed from string to number for autoincrement
  total: number
  cashAmount: number
  mpAmount: number
  change?: number
  createdAt: Date
  items: CartItem[]
}

export type PaymentMethod = 'cash' | 'mercadopago' | null

export type InputMode = 'code' | 'quantity' | 'payment'

export type NotificationType = 'success' | 'error' | 'info' | 'offline_saved'

export interface Notification {
  message: string
  type: NotificationType
}

export interface PaymentState {
  showPaymentModal: boolean
  paymentMethod: PaymentMethod
  paymentInput: string
  isProcessingPayment: boolean
  remainingAmount: number
  mpAmount: number
  cashAmount: number
  change: number
  showingChange: boolean
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