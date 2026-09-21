import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PaymentState } from '../../types'
import { PaymentModal } from './PaymentModal'

const paymentState = (over: Partial<PaymentState> = {}): PaymentState => ({
  showPaymentModal: true,
  paymentMethod: null,
  paymentInput: '',
  isProcessingPayment: false,
  remainingAmount: 100,
  mpAmount: 0,
  cashAmount: 0,
  change: 0,
  showingChange: false,
  ...over,
})

const renderModal = (props: Partial<React.ComponentProps<typeof PaymentModal>> = {}) => {
  const onSelectMethod = vi.fn()
  render(
    <PaymentModal
      show
      paymentState={paymentState()}
      total={100}
      mpConnected
      onSelectMethod={onSelectMethod}
      onConfirmPayment={vi.fn()}
      onBack={vi.fn()}
      onCancel={vi.fn()}
      {...props}
    />,
  )
  return { onSelectMethod }
}

describe('<PaymentModal /> MercadoPago sin conexión (mp_offline)', () => {
  it('habilitado por defecto (online o mp_offline activo): se puede elegir MercadoPago', () => {
    const { onSelectMethod } = renderModal()
    const mp = screen.getByRole('button', { name: /MercadoPago|MERCADO/i })
    expect(mp).toBeEnabled()
    fireEvent.click(mp)
    expect(onSelectMethod).toHaveBeenCalledWith('mercadopago')
    expect(screen.queryByTestId('mp-disabled-msg')).not.toBeInTheDocument()
  })

  it('deshabilitado (offline sin mp_offline): botón bloqueado, mensaje visible y no dispara la selección', () => {
    const { onSelectMethod } = renderModal({ mpDisabled: true })
    const mp = screen.getByRole('button', { name: /MercadoPago|MERCADO/i })
    expect(mp).toBeDisabled()
    expect(screen.getByTestId('mp-disabled-msg')).toHaveTextContent('No disponible sin conexión')
    fireEvent.click(mp)
    expect(onSelectMethod).not.toHaveBeenCalled()
  })

  it('efectivo sigue disponible aunque MercadoPago esté bloqueado', () => {
    const { onSelectMethod } = renderModal({ mpDisabled: true })
    fireEvent.click(screen.getByRole('button', { name: /EFECTIVO|Efectivo/i }))
    expect(onSelectMethod).toHaveBeenCalledWith('cash')
  })
})
