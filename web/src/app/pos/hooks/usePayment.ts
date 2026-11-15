import { useState } from 'react'
import type { PaymentState, PaymentMethod } from '../types'
import { STRINGS } from '../constants/strings'
import { formatMoney } from '@/lib/money'
import { addPaymentLine, type PaymentLine } from '../utils/payments'
import { creditAmountError, creditPaid, parseCollectAmount, round2 } from '../utils/credit'
import type { Customer } from '@/shared/types/credit'

/** Valores finales del cobro que recibe la página al completar la venta. */
export interface PaymentValues {
  payments: PaymentLine[]
  change: number
  /** Deuda cobrada en esta operación (0 = solo venta). */
  collectAmount: number
  /** Cliente del crédito / de la deuda (null = ninguno). */
  creditCustomer: Customer | null
}

const initialState: PaymentState = {
  showPaymentModal: false,
  paymentMethod: null,
  paymentInput: '',
  isProcessingPayment: false,
  remainingAmount: 0,
  payments: [],
  change: 0,
  showingChange: false,
  saleTotal: 0,
  collectDebt: 0,
  collectAmount: 0,
  collectStep: false,
  collectInput: '',
  creditCustomer: null,
}

export interface OpenPaymentOptions {
  /** Deuda del cliente cargada para cobrar: abre primero el paso «monto a cobrar de la deuda». */
  creditDebt?: number
  /** Cliente de esa deuda (también será el del crédito si además se fía parte de la venta nueva). */
  creditCustomer?: Customer | null
}

export const usePayment = (showNotification?: (message: string, type: 'success' | 'error' | 'info') => void) => {
  const [paymentState, setPaymentState] = useState<PaymentState>(initialState)

  /** `total` = total de la venta NUEVA (puede ser 0 si solo se cobra deuda). */
  const openPaymentModal = (total: number, opts: OpenPaymentOptions = {}) => {
    const debt = round2(opts.creditDebt ?? 0)
    setPaymentState({
      ...initialState,
      showPaymentModal: true,
      saleTotal: total,
      collectDebt: debt,
      collectAmount: debt,
      collectStep: debt > 0,
      creditCustomer: opts.creditCustomer ?? null,
      remainingAmount: round2(total + debt),
    })
  }

  const updateCollectInput = (input: string) => {
    setPaymentState(prev => ({ ...prev, collectInput: input }))
  }

  /** Confirma cuánto de la deuda se cobra (vacío = toda) y pasa a elegir los medios. */
  const confirmCollectAmount = (): boolean => {
    const { collectInput, collectDebt, saleTotal } = paymentState
    const r = parseCollectAmount(collectInput, collectDebt)
    if (r.error) { showNotification?.(r.error, 'error'); return false }
    setPaymentState(prev => ({
      ...prev,
      collectAmount: r.amount,
      collectStep: false,
      remainingAmount: round2(saleTotal + r.amount),
    }))
    return true
  }

  /** Elige (o quita) el cliente del crédito. */
  const setCreditCustomer = (customer: Customer | null) => {
    setPaymentState(prev => ({ ...prev, creditCustomer: customer }))
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
    const { paymentMethod, paymentInput, remainingAmount, payments, saleTotal, collectAmount, creditCustomer } = paymentState
    const amount = parseFloat(paymentInput) || 0
    const amountToPay = remainingAmount // Amount still needed to complete the sale

    if (!paymentMethod) return

    if (amount <= 0) {
      if (showNotification) {
        showNotification(STRINGS.NOTIF_INVALID_AMOUNT, 'error')
      }
      return
    }

    // El crédito (fiado) no es dinero entrante: exige cliente, no supera el total de la venta y no da vuelto.
    if (paymentMethod.kind === 'CREDIT') {
      if (!creditCustomer) {
        showNotification?.('Elegí el cliente al que se le fía.', 'error')
        return
      }
      const err = creditAmountError(amount, saleTotal, creditPaid(payments), amountToPay)
      if (err) {
        showNotification?.(err, 'error')
        return
      }
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
      const saleCompleted = round2(amount) >= round2(amountToPay)
      const newChange = saleCompleted && round2(amount) > round2(amountToPay) ? round2(amount - amountToPay) : 0
      const newRemainingAmount = saleCompleted ? 0 : round2(amountToPay - amount)

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
        onComplete(true, { payments: newPayments, change: newChange, collectAmount, creditCustomer })
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
    const { payments, change, collectAmount, creditCustomer } = paymentState
    onComplete(true, { payments, change, collectAmount, creditCustomer })
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
      showingChange: false,
      saleTotal: 0,
      collectDebt: 0,
      collectAmount: 0,
      collectStep: false,
      collectInput: '',
      creditCustomer: null,
    }))
  }

  return {
    paymentState,
    openPaymentModal,
    closePaymentModal,
    selectPaymentMethod,
    updateCollectInput,
    confirmCollectAmount,
    setCreditCustomer,
    updatePaymentInput,
    processPayment,
    confirmChange,
    resetPayment
  }
}
