// Types for POS application
export interface Product {
  id: string
  name: string
  code: string
  barcode?: string
  price: number
  stock: number
  costPrice?: number
  category?: any
}

export interface CartItem {
  id: string
  code: string
  name: string
  price: number
  quantity: number
  total: number
  originalPrice?: number // Precio original antes de promoción
  promotionId?: string // ID de la promoción aplicada
  promotionName?: string // Nombre de la promoción aplicada
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