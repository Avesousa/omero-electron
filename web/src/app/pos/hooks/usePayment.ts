import { useState } from 'react'
import type { PaymentState, PaymentMethod } from '../types'
import { STRINGS } from '../constants/strings'

export const usePayment = (showNotification?: (message: string, type: 'success' | 'error' | 'info') => void) => {
  const [paymentState, setPaymentState] = useState<PaymentState>({
    showPaymentModal: false,
    paymentMethod: null,
    paymentInput: '',
    isProcessingPayment: false,
    remainingAmount: 0,
    mpAmount: 0,
    cashAmount: 0,
    change: 0,
    showingChange: false
  })

  const openPaymentModal = (total: number) => {
    setPaymentState(prev => ({
      ...prev,
      showPaymentModal: true,
      paymentMethod: null,
      paymentInput: '',
      remainingAmount: total,
      mpAmount: 0,
      cashAmount: 0,
      change: 0,
      showingChange: false
    }))
  }

  const closePaymentModal = () => {
    setPaymentState(prev => ({
      ...prev,
      showPaymentModal: false,
      paymentMethod: null,
      paymentInput: '',
      isProcessingPayment: false,
      remainingAmount: 0,
      mpAmount: 0,
      cashAmount: 0,
      change: 0,
      showingChange: false
    }))
  }

  const selectPaymentMethod = (method: PaymentMethod) => {
    setPaymentState(prev => ({
      ...prev,
      paymentMethod: method,
      paymentInput: ''
    }))
    
    if (showNotification) {
      if (method === 'mercadopago') {
        showNotification(STRINGS.NOTIF_METHOD_MP, 'info')
      } else if (method === 'cash') {
        showNotification(STRINGS.NOTIF_METHOD_CASH, 'info')
      }
    }
  }

  const updatePaymentInput = (input: string) => {
    setPaymentState(prev => ({ ...prev, paymentInput: input }))
  }

  const processPayment = async (onComplete: (saleCompleted: boolean, paymentValues?: { cashAmount: number, mpAmount: number, change: number }) => void) => {
    const { paymentMethod, paymentInput, remainingAmount, mpAmount, cashAmount } = paymentState
    const amount = parseFloat(paymentInput) || 0
    const amountToPay = remainingAmount // Amount still needed to complete the sale

    if (amount <= 0) {
      if (showNotification) {
        showNotification(STRINGS.NOTIF_INVALID_AMOUNT, 'error')
      }
      return
    }

    setPaymentState(prev => ({ ...prev, isProcessingPayment: true }))

    const processingTime = paymentMethod === 'mercadopago' ? 2000 : 1500
    const processingMessage = paymentMethod === 'mercadopago'
      ? STRINGS.PAYMENT_PROCESSING_MP
      : STRINGS.PAYMENT_PROCESSING_CASH

    if (showNotification) {
      showNotification(processingMessage, 'info')
    }

    setTimeout(() => {
      let newMpAmount = mpAmount
      let newCashAmount = cashAmount
      let newChange = 0
      let newRemainingAmount = 0
      let saleCompleted = false

      if (amount >= amountToPay) {
        // SUFFICIENT OR OVERPAYMENT
        
        // Add the exact amount entered by user to the selected method
        if (paymentMethod === 'mercadopago') {
          newMpAmount += amount
        } else {
          newCashAmount += amount
        }

        // Calculate change if overpayment
        if (amount > amountToPay) {
          newChange = amount - amountToPay
        }

        newRemainingAmount = 0
        saleCompleted = true

      } else {
        // PARTIAL PAYMENT (insufficient)
        if (paymentMethod === 'mercadopago') {
          newMpAmount += amount
        } else {
          newCashAmount += amount
        }
        newRemainingAmount = amountToPay - amount
        saleCompleted = false
      }

      setPaymentState(prev => ({
        ...prev,
        mpAmount: newMpAmount,
        cashAmount: newCashAmount,
        change: newChange,
        remainingAmount: newRemainingAmount,
        isProcessingPayment: false,
        paymentInput: '',
        paymentMethod: saleCompleted && newChange === 0 ? null : null, // Only reset method if exact payment
        showingChange: saleCompleted && newChange > 0 // Show change screen if overpaid
      }))

      if (saleCompleted && newChange === 0) { // Exact payment
        if (showNotification) {
          showNotification(STRINGS.NOTIF_SALE_COMPLETED, 'success')
        }
        closePaymentModal()
        onComplete(true, { cashAmount: newCashAmount, mpAmount: newMpAmount, change: newChange })
      } else if (saleCompleted && newChange > 0) { // Overpayment with change
        if (showNotification) {
          const changeMessage = paymentMethod === 'mercadopago'
            ? `${STRINGS.NOTIF_PAYMENT_SUCCESS_RETURN} $${newChange.toLocaleString()}`
            : `${STRINGS.NOTIF_PAYMENT_SUCCESS_CHANGE} $${newChange.toLocaleString()}`
          showNotification(changeMessage, 'success')
        }
        // Do not call onComplete yet, wait for user to confirm change
      } else { // Partial payment
        if (showNotification) {
          showNotification(`${STRINGS.NOTIF_SALE_PARTIAL} $${newRemainingAmount.toLocaleString()}`, 'info')
        }
        setPaymentState(prev => ({ ...prev, paymentMethod: null })) // Go back to method selection
      }
    }, processingTime)
  }

  const confirmChange = (onComplete: (saleCompleted: boolean, paymentValues?: { cashAmount: number, mpAmount: number, change: number }) => void) => {
    // Pasar los valores del estado actual al callback
    const { cashAmount, mpAmount, change } = paymentState
    onComplete(true, { cashAmount, mpAmount, change })
  }

  const resetPayment = () => {
    setPaymentState(prev => ({
      ...prev,
      paymentMethod: null,
      paymentInput: '',
      isProcessingPayment: false,
      remainingAmount: 0,
      mpAmount: 0,
      cashAmount: 0,
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