import type { PaymentState, PaymentMethod } from '../../types'
import { paymentColor, paymentDescription } from '@/shared/constants/paymentMethods'
import { STRINGS } from '../../constants/strings'
import { KeyboardGuide } from '../keyboard/KeyboardGuide'
import { Modal } from '@/app/components/ui/Modal'
import { formatMoney } from '@/lib/money'
import type { Customer } from '@/shared/types/credit'
import { CustomerPicker } from './CustomerPicker'

/** Selector de cliente para el medio Crédito (lo arma la página con `useCustomerPicker` + `useCustomers`). */
export interface PaymentCustomerPicker {
  customers: Customer[]
  query: string
  loading?: boolean
  error?: string
  onSelect: (customer: Customer) => void
  onQuickCreate: (name: string) => void
  quickBusy?: boolean
}

interface PaymentModalProps {
  show: boolean
  paymentState: PaymentState
  total: number
  mpConnected: boolean
  /** Desktop sin conexión y sin `mp_offline`: el cobro con MercadoPago no está permitido. */
  mpDisabled?: boolean
  /** Medios activos, en el orden del cobro. */
  methods: PaymentMethod[]
  onSelectMethod: (method: PaymentMethod) => void
  onConfirmPayment: () => void
  onBack: () => void
  onCancel: () => void
  onKeyPress?: (key: string) => void
  customerPicker?: PaymentCustomerPicker
}

export const PaymentModal = ({
  show,
  paymentState,
  total,
  mpConnected,
  mpDisabled = false,
  methods,
  onSelectMethod,
  onConfirmPayment,
  onBack,
  onCancel,
  onKeyPress,
  customerPicker
}: PaymentModalProps) => {
  if (!show) return null

  // Los atajos de teclado del POS cierran/retroceden; la X no aplica en el flujo de cobro
  const shell = { isOpen: true as const, onClose: onCancel, hideClose: true, closeOnEsc: false, accent: 'primary' as const, size: 'lg' as const }

  const {
    paymentMethod,
    paymentInput,
    isProcessingPayment,
    remainingAmount,
    payments,
    change,
    showingChange,
    collectStep,
    collectInput,
    collectDebt,
    collectAmount,
    saleTotal,
    creditCustomer
  } = paymentState
  const hasCollection = collectDebt > 0

  const isPartial = remainingAmount > 0 && remainingAmount < total

  const PaidSoFar = () => payments.length > 0 ? (
    <div className="flex justify-center gap-2 flex-wrap">
      {payments.map(p => (
        <span key={p.methodId} className="pos-chip" style={{ borderColor: paymentColor(p.color).bg, color: paymentColor(p.color).bg }}>
          {p.name} <b className="pos-num">{formatMoney(p.amount)}</b>
        </span>
      ))}
    </div>
  ) : null

  const MpStatus = () => (
    <span className={`pos-chip ${mpConnected ? 'is-ok' : 'is-bad'}`}>
      <span className="pos-dot" />
      {mpConnected ? 'Mercado Pago conectado' : 'Sin conexión con Mercado Pago'}
    </span>
  )

  // Pantalla de vuelto
  if (showingChange) {
    return (
      <Modal {...shell} accent="success" title="¡Cobrado!">
        <div className="pos-pay text-center space-y-5">
          <div className="pos-change">
            <div className="pos-check">✓</div>
            <div className="text-sm font-bold uppercase tracking-wider opacity-90 relative">{STRINGS.PAYMENT_RETURN.replace(':', '')}</div>
            <div className="v pos-num">{formatMoney(change)}</div>
          </div>

          <div className="pos-card-2 p-4 grid grid-cols-2 gap-3 text-left">
            <div>
              <div className="pos-eyebrow">Total venta</div>
              <div className="text-lg font-extrabold pos-ink pos-num">{formatMoney(total)}</div>
            </div>
            <div>
              <div className="pos-eyebrow">Recibido</div>
              <div className="text-lg font-extrabold pos-ink pos-num">{formatMoney(total + change)}</div>
            </div>
            {payments.map(p => (
              <div key={p.methodId}>
                <div className="pos-eyebrow">{p.name}</div>
                <div className="font-bold pos-num" style={{ color: paymentColor(p.color).bg }}>{formatMoney(p.amount)}</div>
              </div>
            ))}
          </div>

          <button onClick={onConfirmPayment} className="pos-btn is-accent w-full">
            Finalizar venta <span className="pos-kbd">Enter</span>
          </button>
        </div>
      </Modal>
    )
  }

  // Paso previo: cuánto de la deuda del cliente se cobra (Enter sin escribir = toda)
  if (collectStep) {
    return (
      <Modal {...shell} accent="brand" title="Cobro de deuda">
        <div className="pos-pay text-center space-y-5" data-testid="collect-step">
          <div className="pos-muted">
            Cliente: <b className="pos-ink">{creditCustomer ? `#${creditCustomer.code} ${creditCustomer.name}` : ''}</b>
          </div>
          <div className="pos-pay-amount">
            <div className="pos-eyebrow">Deuda actual</div>
            <div className="v pos-num">{formatMoney(collectDebt)}</div>
          </div>
          <div className="pos-entry">
            <div className="pos-eyebrow mb-2">Monto a cobrar (vacío = toda la deuda)</div>
            <div className="v pos-num">{collectInput ? `$${collectInput}` : formatMoney(collectDebt)}</div>
          </div>
          {saleTotal > 0 && (
            <div className="text-sm pos-muted">Además, venta nueva de {formatMoney(saleTotal)}: se cobra en el mismo pago, como registros separados.</div>
          )}
          <div className="flex justify-center gap-3">
            <button onClick={onConfirmPayment} className="pos-btn is-primary">Continuar <span className="pos-kbd">Enter</span></button>
            <button onClick={onCancel} className="pos-btn is-ghost-danger"><span className="pos-kbd is-light">Esc</span> Cancelar</button>
          </div>
          <KeyboardGuide variant="collect" onKeyPress={onKeyPress} />
        </div>
      </Modal>
    )
  }

  // Elección del medio de pago
  if (!paymentMethod) {
    return (
      <Modal {...shell} title={isPartial ? 'Cobrá el resto' : '¿Cómo te pagan?'}>
        <div className="pos-pay space-y-5">
          <div className="pos-pay-amount">
            <div className="pos-eyebrow">{isPartial ? 'Resta cobrar' : 'Total a cobrar'}</div>
            <div className="v pos-num">{formatMoney(remainingAmount > 0 ? remainingAmount : total)}</div>
          </div>

          {hasCollection && (
            <div className="text-sm text-center pos-muted" data-testid="collect-breakdown">
              {saleTotal > 0 && <span>Venta nueva {formatMoney(saleTotal)} · </span>}
              <b className="pos-ink">Cobro de deuda {formatMoney(collectAmount)}</b>
            </div>
          )}

          <PaidSoFar />

          <div className="grid grid-cols-2 gap-4">
            {methods.map(m => {
              const c = paymentColor(m.color)
              const blocked = mpDisabled && m.kind === 'MERCADOPAGO'
              return (
                <button
                  key={m.id}
                  onClick={() => onSelectMethod(m)}
                  disabled={blocked}
                  title={blocked ? 'MercadoPago no está habilitado sin conexión' : undefined}
                  className="pos-method"
                  style={{ borderColor: c.border }}
                >
                  <span className="k">{m.shortcutKey}</span>
                  <span className="ic font-extrabold text-lg" style={{ background: c.bg, color: c.text }}>{m.name.charAt(0).toUpperCase()}</span>
                  <span className="t">{m.name}</span>
                  {paymentDescription(m) && <span className="s" data-testid="method-description">{paymentDescription(m)}</span>}
                  {blocked && <span className="s pos-danger" data-testid="mp-disabled-msg">No disponible sin conexión</span>}
                </button>
              )
            })}
          </div>

          <div className="flex items-center justify-between gap-3">
            {methods.some(m => m.kind === 'MERCADOPAGO') ? <MpStatus /> : <span />}
            <button onClick={onCancel} className="pos-btn is-ghost-danger">
              <span className="pos-kbd is-light">Esc</span> Cancelar
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  // Medio Crédito sin cliente: primero se elige a quién se le fía
  if (paymentMethod.kind === 'CREDIT' && !creditCustomer && customerPicker) {
    return (
      <Modal {...shell} accent="brand" title={`${paymentMethod.name} · elegí el cliente`}>
        <div className="pos-pay space-y-4" data-testid="credit-customer-step">
          <CustomerPicker {...customerPicker} />
          <div className="flex justify-center">
            <button onClick={onBack} className="pos-btn"><span className="pos-kbd is-light">Esc</span> Volver</button>
          </div>
          <KeyboardGuide variant="customer" onKeyPress={onKeyPress} />
        </div>
      </Modal>
    )
  }

  // Ingreso del monto
  const isCredit = paymentMethod.kind === 'CREDIT'
  const isMercadoPago = paymentMethod.kind === 'MERCADOPAGO'
  const isCash = paymentMethod.kind === 'CASH'
  const mc = paymentColor(paymentMethod.color)

  return (
    <Modal {...shell} title={isMercadoPago ? 'Cobro con Mercado Pago' : isCash ? 'Pago en efectivo' : `Cobro con ${paymentMethod.name}`}>
      <div className="pos-pay text-center space-y-5">
        <div className="flex justify-center items-center gap-2 flex-wrap text-sm pos-muted">
          <span>Total de la venta <b className="pos-ink pos-num">{formatMoney(total)}</b></span>
          {isPartial && <span className="pos-chip is-warn">Resta <b className="pos-num">{formatMoney(remainingAmount)}</b></span>}
          {isMercadoPago && <MpStatus />}
        </div>

        {isCredit && (
          <div className="text-sm pos-muted" data-testid="credit-note">
            Fiado a <b className="pos-ink">#{creditCustomer?.code} {creditCustomer?.name}</b> · no es dinero cobrado y no da vuelto (máximo {formatMoney(Math.min(remainingAmount, saleTotal))}).
          </div>
        )}

        <div className="pos-entry" style={{ borderColor: mc.bg, boxShadow: `0 0 0 6px color-mix(in srgb, ${mc.bg} 18%, transparent)` }}>
          <div className="pos-eyebrow mb-2">
            {isCash ? '¿Con cuánto te pagan?' : 'Monto a cobrar'}
          </div>
          <div className="v pos-num">${paymentInput || '0'}</div>
          <div className="text-xs pos-muted mt-3">Escribí el monto y tocá Enter</div>
        </div>

        <PaidSoFar />

        {change > 0 && !isCredit && (
          <div className="pos-chip is-ok text-base">
            {isCash ? STRINGS.PAYMENT_CHANGE : STRINGS.PAYMENT_RETURN} <b className="pos-num">{formatMoney(change)}</b>
          </div>
        )}

        {isProcessingPayment ? (
          <div className="pos-card-2 p-5 flex items-center justify-center gap-3">
            <div className="animate-spin rounded-full h-7 w-7 border-[3px] border-t-transparent" style={{ borderColor: mc.bg, borderTopColor: 'transparent' }} />
            <div className="font-bold pos-ink">Procesando pago…</div>
          </div>
        ) : (
          <button
            onClick={onConfirmPayment}
            className="pos-btn w-full"
            style={{ background: mc.bg, color: mc.text, borderColor: mc.border }}
            disabled={!paymentInput || parseFloat(paymentInput) <= 0}
          >
            Confirmar pago <span className="pos-kbd">Enter</span>
          </button>
        )}

        <div className="flex justify-center gap-3">
          <button onClick={onBack} className="pos-btn" disabled={isProcessingPayment}>
            <span className="pos-kbd is-light">Esc</span> Volver
          </button>
          <button onClick={onCancel} className="pos-btn is-ghost-danger" disabled={isProcessingPayment}>
            Cancelar todo
          </button>
        </div>

        <KeyboardGuide variant="payment" onKeyPress={onKeyPress} />
      </div>
    </Modal>
  )
}
