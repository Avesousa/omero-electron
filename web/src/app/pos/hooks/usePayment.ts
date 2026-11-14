import { useState } from 'react'
import type { PaymentState, PaymentMethod } from '../types'
import { STRINGS } from '../constants/strings'
import { formatMoney } from '@/lib/money'
import { addPaymentLine, type PaymentLine } from '../utils/payments'

/** Valores finales del cobro que recibe la página al completar la venta. */
export interface PaymentValues {
  payments: PaymentLine[]
  change: number
}

const initialState: PaymentState = {
  showPaymentModal: false,
  paymentMethod: null,
  paymentInput: '',
  isProcessingPayment: false,
  remainingAmount: 0,
  payments: [],
  change: 0,
  showingChange: false
}

export const usePayment = (showNotification?: (message: string, type: 'success' | 'error' | 'info') => void) => {
  const [paymentState, setPaymentState] = useState<PaymentState>(initialState)

  const openPaymentModal = (total: number) => {
    setPaymentState({ ...initialState, showPaymentModal: true, remainingAmount: total })
  }

  const closePaymentModal = () => {
    setPaymentState(initialState)
  }

  const selectPaymentMethod = (method: PaymentMethod | null) => {
    setPaymentState(prev => ({
      ...prev,
      paymentMethod: method,
      paymentInput: ''
    }))

    if (method && showNotification) {
      showNotification(`Método seleccionado: ${method.name}`, 'info')
    }
  }

  const updatePaymentInput = (input: string) => {
    setPaymentState(prev => ({ ...prev, paymentInput: input }))
  }

  const processPayment = async (onComplete: (saleCompleted: boolean, paymentValues?: PaymentValues) => void) => {
    const { paymentMethod, paymentInput, remainingAmount, payments } = paymentState
    const amount = parseFloat(paymentInput) || 0
    const amountToPay = remainingAmount // Amount still needed to complete the sale

    if (!paymentMethod) return

    if (amount <= 0) {
      if (showNotification) {
        showNotification(STRINGS.NOTIF_INVALID_AMOUNT, 'error')
      }
      return
    }

    setPaymentState(prev => ({ ...prev, isProcessingPayment: true }))

    const isMp = paymentMethod.kind === 'MERCADOPAGO'
    const processingTime = isMp ? 2000 : 1500
    const processingMessage = isMp
      ? STRINGS.PAYMENT_PROCESSING_MP
      : paymentMethod.kind === 'CASH'
        ? STRINGS.PAYMENT_PROCESSING_CASH
        : `Procesando pago con ${paymentMethod.name}...`

    if (showNotification) {
      showNotification(processingMessage, 'info')
    }

    setTimeout(() => {
      // El importe exacto que ingresó el cajero se suma al medio elegido
      const newPayments = addPaymentLine(payments, paymentMethod, amount)
      const saleCompleted = amount >= amountToPay
      const newChange = saleCompleted && amount > amountToPay ? amount - amountToPay : 0
      const newRemainingAmount = saleCompleted ? 0 : amountToPay - amount

      setPaymentState(prev => ({
        ...prev,
        payments: newPayments,
        change: newChange,
        remainingAmount: newRemainingAmount,
        isProcessingPayment: false,
        paymentInput: '',
        paymentMethod: null,
        showingChange: saleCompleted && newChange > 0 // Show change screen if overpaid
      }))

      if (saleCompleted && newChange === 0) { // Exact payment
        if (showNotification) {
          showNotification(STRINGS.NOTIF_SALE_COMPLETED, 'success')
        }
        closePaymentModal()
        onComplete(true, { payments: newPayments, change: newChange })
      } else if (saleCompleted && newChange > 0) { // Overpayment with change
        if (showNotification) {
          const changeMessage = paymentMethod.kind === 'CASH'
            ? `${STRINGS.NOTIF_PAYMENT_SUCCESS_CHANGE} ${formatMoney(newChange)}`
            : `${STRINGS.NOTIF_PAYMENT_SUCCESS_RETURN} ${formatMoney(newChange)}`
          showNotification(changeMessage, 'success')
        }
        // Do not call onComplete yet, wait for user to confirm change
      } else { // Partial payment
        if (showNotification) {
          showNotification(`${STRINGS.NOTIF_SALE_PARTIAL} ${formatMoney(newRemainingAmount)}`, 'info')
        }
      }
    }, processingTime)
  }

  const confirmChange = (onComplete: (saleCompleted: boolean, paymentValues?: PaymentValues) => void) => {
    // Pasar los valores del estado actual al callback
    const { payments, change } = paymentState
    onComplete(true, { payments, change })
  }

  const resetPayment = () => {
    setPaymentState(prev => ({
      ...prev,
      paymentMethod: null,
      paymentInput: '',
      isProcessingPayment: false,
      remainingAmount: 0,
      payments: [],
      change: 0,
      showingChange: false
    }))
  }

  return {
    paymentState,
    openPaymentModal,
    closePaymentModal,
    selectPaymentMethod,
    updatePaymentInput,
    processPayment,
    confirmChange,
    resetPayment
  }
}
