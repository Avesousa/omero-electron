import type { PaymentState } from '../../types'
import { STRINGS } from '../../constants/strings'
import { KeyboardGuide } from '../keyboard/KeyboardGuide'
import { Modal } from '@/app/components/ui/Modal'
import { formatMoney } from '@/lib/money'

interface PaymentModalProps {
  show: boolean
  paymentState: PaymentState
  total: number
  mpConnected: boolean
  /** Desktop sin conexión y sin `mp_offline`: el cobro con MercadoPago no está permitido. */
  mpDisabled?: boolean
  onSelectMethod: (method: 'mercadopago' | 'cash') => void
  onConfirmPayment: () => void
  onBack: () => void
  onCancel: () => void
  onKeyPress?: (key: string) => void
}

export const PaymentModal = ({
  show,
  paymentState,
  total,
  mpConnected,
  mpDisabled = false,
  onSelectMethod,
  onConfirmPayment,
  onBack,
  onCancel,
  onKeyPress
}: PaymentModalProps) => {
  if (!show) return null

  // Los atajos de teclado del POS cierran/retroceden; la X no aplica en el flujo de cobro
  const shell = { isOpen: true as const, onClose: onCancel, hideClose: true, closeOnEsc: false, accent: 'primary' as const, size: 'lg' as const }

  const {
    paymentMethod,
    paymentInput,
    isProcessingPayment,
    remainingAmount,
    mpAmount,
    cashAmount,
    change,
    showingChange
  } = paymentState

  const isPartial = remainingAmount > 0 && remainingAmount < total

  const PaidSoFar = () => (mpAmount > 0 || cashAmount > 0) ? (
    <div className="flex justify-center gap-2 flex-wrap">
      {mpAmount > 0 && <span className="pos-chip is-mp">Mercado Pago <b className="pos-num">{formatMoney(mpAmount)}</b></span>}
      {cashAmount > 0 && <span className="pos-chip is-ok">Efectivo <b className="pos-num">{formatMoney(cashAmount)}</b></span>}
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
            {cashAmount > 0 && (
              <div>
                <div className="pos-eyebrow">Efectivo</div>
                <div className="font-bold pos-success pos-num">{formatMoney(cashAmount)}</div>
              </div>
            )}
            {mpAmount > 0 && (
              <div>
                <div className="pos-eyebrow">Mercado Pago</div>
                <div className="font-bold pos-num" style={{ color: 'var(--pos-mp)' }}>{formatMoney(mpAmount)}</div>
              </div>
            )}
          </div>

          <button onClick={onConfirmPayment} className="pos-btn is-accent w-full">
            Finalizar venta <span className="pos-kbd">Enter</span>
          </button>
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

          <PaidSoFar />

          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => onSelectMethod('mercadopago')}
              disabled={mpDisabled}
              title={mpDisabled ? 'MercadoPago no está habilitado sin conexión' : undefined}
              className="pos-method is-mp"
            >
              <span className="k">1</span>
              <span className="ic font-extrabold text-lg">QR</span>
              <span className="t">Mercado Pago</span>
              <span className="s">QR o transferencia</span>
              {mpDisabled && <span className="s pos-danger" data-testid="mp-disabled-msg">No disponible sin conexión</span>}
            </button>

            <button onClick={() => onSelectMethod('cash')} className="pos-method is-cash">
              <span className="k">2</span>
              <span className="ic">$</span>
              <span className="t">Efectivo</span>
              <span className="s">Te calculo el vuelto</span>
            </button>
          </div>

          <div className="flex items-center justify-between gap-3">
            <MpStatus />
            <button onClick={onCancel} className="pos-btn is-ghost-danger">
              <span className="pos-kbd is-light">Esc</span> Cancelar
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  // Ingreso del monto
  const isMercadoPago = paymentMethod === 'mercadopago'

  return (
    <Modal {...shell} title={isMercadoPago ? 'Cobro con Mercado Pago' : 'Pago en efectivo'}>
      <div className="pos-pay text-center space-y-5">
        <div className="flex justify-center items-center gap-2 flex-wrap text-sm pos-muted">
          <span>Total de la venta <b className="pos-ink pos-num">{formatMoney(total)}</b></span>
          {isPartial && <span className="pos-chip is-warn">Resta <b className="pos-num">{formatMoney(remainingAmount)}</b></span>}
          {isMercadoPago && <MpStatus />}
        </div>

        <div className={`pos-entry ${isMercadoPago ? 'is-mp' : ''}`}>
          <div className="pos-eyebrow mb-2">
            {isMercadoPago ? 'Monto a cobrar' : '¿Con cuánto te pagan?'}
          </div>
          <div className="v pos-num">${paymentInput || '0'}</div>
          <div className="text-xs pos-muted mt-3">Escribí el monto y tocá Enter</div>
        </div>

        <PaidSoFar />

        {change > 0 && (
          <div className="pos-chip is-ok text-base">
            {isMercadoPago ? STRINGS.PAYMENT_RETURN : STRINGS.PAYMENT_CHANGE} <b className="pos-num">{formatMoney(change)}</b>
          </div>
        )}

        {isProcessingPayment ? (
          <div className="pos-card-2 p-5 flex items-center justify-center gap-3">
            <div className="animate-spin rounded-full h-7 w-7 border-[3px] border-t-transparent" style={{ borderColor: isMercadoPago ? 'var(--pos-mp)' : 'var(--pos-success)', borderTopColor: 'transparent' }} />
            <div className="font-bold pos-ink">Procesando pago…</div>
          </div>
        ) : (
          <button
            onClick={onConfirmPayment}
            className={`pos-btn w-full ${isMercadoPago ? 'is-mp' : 'is-primary'}`}
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
