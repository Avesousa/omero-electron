import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PaymentState } from '../../types'
import { FALLBACK_PAYMENT_METHODS, type PaymentMethod } from '@/shared/constants/paymentMethods'
import { PaymentModal } from './PaymentModal'

const paymentState = (over: Partial<PaymentState> = {}): PaymentState => ({
  showPaymentModal: true,
  paymentMethod: null,
  paymentInput: '',
  isProcessingPayment: false,
  remainingAmount: 100,
  payments: [],
  change: 0,
  showingChange: false,
  saleTotal: 100,
  collectDebt: 0,
  collectAmount: 0,
  collectStep: false,
  collectInput: '',
  creditCustomer: null,
  ...over,
})

const renderModal = (props: Partial<React.ComponentProps<typeof PaymentModal>> = {}) => {
  const onSelectMethod = vi.fn()
  render(
    <PaymentModal
      show
      paymentState={paymentState()}
      methods={[...FALLBACK_PAYMENT_METHODS]}
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
    expect(onSelectMethod).toHaveBeenCalledWith(expect.objectContaining({ kind: 'MERCADOPAGO' }))
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
    expect(onSelectMethod).toHaveBeenCalledWith(expect.objectContaining({ kind: 'CASH' }))
  })
})

const custom: PaymentMethod = {
  id: '11111111-1111-1111-1111-111111111111', kind: 'CUSTOM', name: 'Transferencia', shortcutKey: 3, color: 'violet', sortOrder: 3,
  active: true, isDefault: false, generatesExpense: false, expenseRate: 0, expenseCategory: null, expenseDescription: null, deletable: true,
}

describe('<PaymentModal /> medios configurables', () => {
  it('muestra cada medio activo con su tecla y permite elegir uno personalizado', () => {
    const { onSelectMethod } = renderModal({ methods: [...FALLBACK_PAYMENT_METHODS, custom] })
    const btn = screen.getByRole('button', { name: /Transferencia/ })
    expect(btn).toHaveTextContent('3')
    fireEvent.click(btn)
    expect(onSelectMethod).toHaveBeenCalledWith(expect.objectContaining({ id: custom.id, kind: 'CUSTOM' }))
  })

  it('sin MercadoPago entre los medios no muestra su indicador de conexión', () => {
    renderModal({ methods: [FALLBACK_PAYMENT_METHODS[1], custom] })
    expect(screen.queryByText(/Mercado Pago conectado/)).not.toBeInTheDocument()
  })

  it('lista lo cobrado hasta ahora por medio (pago dividido)', () => {
    renderModal({
      paymentState: paymentState({
        remainingAmount: 40,
        payments: [{ methodId: custom.id, kind: 'CUSTOM', name: 'Transferencia', color: 'violet', amount: 60 }],
      }),
    })
    expect(screen.getByText(/Transferencia/, { selector: 'span.pos-chip' })).toBeInTheDocument()
  })
})

describe('<PaymentModal /> descripción del medio', () => {
  it('muestra la descripción configurada como subtítulo bajo el nombre', () => {
    const custom: PaymentMethod = { ...FALLBACK_PAYMENT_METHODS[0], id: 'x', kind: 'CUSTOM', name: 'Cuenta DNI', description: 'Pagos con QR del banco', shortcutKey: 3 }
    renderModal({ methods: [...FALLBACK_PAYMENT_METHODS, custom] })
    expect(screen.getByText('Pagos con QR del banco')).toBeInTheDocument()
  })

  it('sin descripción (null) no muestra subtítulo; con cache viejo (sin el campo) conserva los de siempre', () => {
    const noDesc: PaymentMethod = { ...FALLBACK_PAYMENT_METHODS[0], id: 'y', kind: 'CUSTOM', name: 'Vale', description: null, shortcutKey: 3 }
    const { description: _a, ...oldCash } = FALLBACK_PAYMENT_METHODS[1]
    renderModal({ methods: [noDesc, oldCash as PaymentMethod] })
    expect(screen.getAllByTestId('method-description')).toHaveLength(1)
    expect(screen.getByText('Te calculo el vuelto')).toBeInTheDocument()
  })
})


const creditMethod: PaymentMethod = {
  id: '22222222-2222-2222-2222-222222222222', kind: 'CREDIT', name: 'Crédito', shortcutKey: 4, color: 'violet', sortOrder: 4,
  active: true, isDefault: false, generatesExpense: false, expenseRate: 0, expenseCategory: null, expenseDescription: null, deletable: false,
}
const ana = { id: 'a', code: 42, name: 'Ana', active: true, extra: {}, debt: 0, pendingLines: 0, oldestPendingAt: null, createdAt: '' }
const picker = (over = {}) => ({ customers: [ana], query: '', onSelect: vi.fn(), onQuickCreate: vi.fn(), ...over })

describe('<PaymentModal /> crédito: elegí el cliente', () => {
  it('con medio Crédito y sin cliente muestra el paso "elegí el cliente" en vez del monto', () => {
    const customerPicker = picker()
    renderModal({ paymentState: paymentState({ paymentMethod: creditMethod }), customerPicker })
    expect(screen.getByTestId('credit-customer-step')).toBeInTheDocument()
    expect(screen.getByText(/elegí el cliente/i)).toBeInTheDocument()
    expect(screen.queryByText('Confirmar pago')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('customer-row'))
    expect(customerPicker.onSelect).toHaveBeenCalledWith(ana)
  })

  it('el alta rápida con nombre llama a onQuickCreate', () => {
    const customerPicker = picker()
    renderModal({ paymentState: paymentState({ paymentMethod: creditMethod }), customerPicker })
    fireEvent.click(screen.getByText('+ Cliente nuevo con nombre'))
    fireEvent.change(screen.getByLabelText('Nombre del cliente nuevo'), { target: { value: ' Juan ' } })
    fireEvent.click(screen.getByText('Crear'))
    expect(customerPicker.onQuickCreate).toHaveBeenCalledWith('Juan')
  })

  it('con cliente elegido muestra la nota de fiado y nunca el vuelto', () => {
    renderModal({ paymentState: paymentState({ paymentMethod: creditMethod, creditCustomer: ana, paymentInput: '150', change: 50 }), customerPicker: picker() })
    expect(screen.queryByTestId('credit-customer-step')).not.toBeInTheDocument()
    expect(screen.getByTestId('credit-note')).toHaveTextContent('#42 Ana')
    expect(screen.getByTestId('credit-note')).toHaveTextContent('no da vuelto')
    expect(document.querySelector('.pos-chip.is-ok')).toBeNull() // el chip de vuelto no aparece
  })
})

describe('<PaymentModal /> cobro de deuda', () => {
  it('paso previo del monto: muestra la deuda y, vacío, propone toda', () => {
    const onConfirmPayment = vi.fn()
    renderModal({
      paymentState: paymentState({ collectStep: true, collectDebt: 500, collectAmount: 500, saleTotal: 0, creditCustomer: ana, remainingAmount: 500 }),
      onConfirmPayment,
    })
    const step = screen.getByTestId('collect-step')
    expect(step).toHaveTextContent('#42 Ana')
    expect(step).toHaveTextContent('500')
    fireEvent.click(screen.getByText(/Continuar/))
    expect(onConfirmPayment).toHaveBeenCalled()
  })

  it('en la elección del medio resume venta nueva + cobro de deuda', () => {
    renderModal({ paymentState: paymentState({ collectDebt: 500, collectAmount: 300, saleTotal: 100, remainingAmount: 400 }), total: 400 })
    expect(screen.getByTestId('collect-breakdown')).toHaveTextContent(/Venta nueva/)
    expect(screen.getByTestId('collect-breakdown')).toHaveTextContent(/Cobro de deuda/)
  })
})
