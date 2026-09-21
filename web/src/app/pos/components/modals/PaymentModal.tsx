import type { PaymentState } from '../../types'
import { STRINGS } from '../../constants/strings'
import { KeyboardGuide } from '../keyboard/KeyboardGuide'
import { Modal } from '@/app/components/ui/Modal'

interface PaymentModalProps {
  show: boolean
  paymentState: PaymentState
  total: number
  mpConnected: boolean
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
  onSelectMethod,
  onConfirmPayment,
  onBack,
  onCancel,
  onKeyPress
}: PaymentModalProps) => {
  if (!show) return null

  // Los atajos de teclado del POS cierran/retroceden; la X no aplica en el flujo de cobro
  const shell = { isOpen: true as const, onClose: onCancel, hideClose: true, closeOnEsc: false, tone: 'dark' as const, accent: 'primary' as const, size: 'lg' as const }

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

  // Change Confirmation Screen
  if (showingChange) {
    return (
      <Modal {...shell} accent="warning" title={STRINGS.PAYMENT_CHANGE || "VUELTO A ENTREGAR"}>
          <div className="text-center space-y-6">
            {/* Change Amount Display */}
            <div className="bg-black border-4 border-yellow-500 p-6">
              <div className="text-xl text-gray-300 mb-2">VUELTO:</div>
              <div className="text-5xl font-bold text-yellow-400">
                ${change.toLocaleString()}
              </div>
            </div>
            
            {/* Payment Summary */}
            <div className="bg-gray-800 border-2 border-gray-600 p-4">
              <div className="text-lg text-gray-300 mb-3">Resumen del pago:</div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-400">Total venta:</span>
                  <span className="text-white font-bold ml-2">${total.toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-gray-400">Recibido:</span>
                  <span className="text-white font-bold ml-2">${(total + change).toLocaleString()}</span>
                </div>
                {cashAmount > 0 && (
                  <div>
                    <span className="text-green-400">Efectivo:</span>
                    <span className="text-white font-bold ml-2">${cashAmount.toLocaleString()}</span>
                  </div>
                )}
                {mpAmount > 0 && (
                  <div>
                    <span className="text-blue-400">Mercado Pago:</span>
                    <span className="text-white font-bold ml-2">${mpAmount.toLocaleString()}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Finalize Button */}
            <button
              onClick={onConfirmPayment}
              className="bg-yellow-600 border-4 border-yellow-400 text-black font-bold py-6 px-8 text-2xl hover:bg-yellow-500 transition-colors"
            >
              ✅ FINALIZAR VENTA - ENTER
            </button>

            <div className="text-center text-gray-400 text-sm">
              Presione ENTER para finalizar la venta
            </div>
          </div>
      </Modal>
    )
  }

  if (!paymentMethod) {
    // Method Selection Screen
    return (
      <Modal {...shell} title={STRINGS.PAYMENT_METHOD_TITLE}>
          <div className="space-y-6">
            <div className="text-center">
              <div className="text-xl text-gray-300 mb-4">
                {remainingAmount > 0 && remainingAmount < total 
                  ? STRINGS.PAYMENT_SELECT_REMAINING
                  : STRINGS.PAYMENT_SELECT_METHOD}
              </div>
              
              {/* Payment Summary */}
              <div className="grid grid-cols-1 gap-4 mb-6">
                <div className="bg-black border-4 border-yellow-500 p-4 text-center">
                  <div className="text-xl text-gray-300 mb-2">
                    {remainingAmount > 0 && remainingAmount < total ? STRINGS.PAYMENT_REMAINING : STRINGS.PAYMENT_TOTAL}
                  </div>
                  <div className="text-4xl font-bold text-yellow-400">
                    ${(remainingAmount > 0 ? remainingAmount : total).toLocaleString()}
                  </div>
                </div>
                
                {/* Show payments made so far */}
                {(mpAmount > 0 || cashAmount > 0) && (
                  <div className="grid grid-cols-2 gap-2">
                    {mpAmount > 0 && (
                      <div className="bg-black border-2 border-blue-500 p-3 text-center">
                        <div className="text-sm text-gray-300">{STRINGS.PAYMENT_MERCADOPAGO}</div>
                        <div className="text-lg font-bold text-blue-400">${mpAmount.toLocaleString()}</div>
                      </div>
                    )}
                    {cashAmount > 0 && (
                      <div className="bg-black border-2 border-green-500 p-3 text-center">
                        <div className="text-sm text-gray-300">EFECTIVO</div>
                        <div className="text-lg font-bold text-green-400">${cashAmount.toLocaleString()}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* MercadoPago connectivity indicator */}
            <div className="flex items-center gap-2 text-sm">
              <span className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${mpConnected ? 'bg-green-400' : 'bg-red-500'}`} />
              <span className={mpConnected ? 'text-green-400' : 'text-red-400'}>
                {mpConnected ? 'MercadoPago activo' : 'Sin conexión con MercadoPago'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <button
                onClick={() => onSelectMethod('mercadopago')}
                className="bg-blue-600 border-4 border-blue-400 text-white font-bold py-8 px-6 text-xl hover:bg-blue-700 transition-colors"
              >
                <div className="text-4xl mb-2">💳</div>
                <div>1 - {STRINGS.PAYMENT_MERCADOPAGO}</div>
              </button>
              
              <button
                onClick={() => onSelectMethod('cash')}
                className="bg-green-600 border-4 border-green-400 text-white font-bold py-8 px-6 text-xl hover:bg-green-700 transition-colors"
              >
                <div className="text-4xl mb-2">💵</div>
                <div>2 - {STRINGS.PAYMENT_CASH}</div>
              </button>
            </div>

            <div className="text-center">
              <button
                onClick={onCancel}
                className="bg-red-900 border border-red-700 text-red-300 py-1.5 px-6 text-sm font-medium"
              >
                {STRINGS.BTN_BACK} - {STRINGS.BTN_CANCEL}
              </button>
            </div>
          </div>
      </Modal>
    )
  }

  // Specific Payment Method Screen
  const isMercadoPago = paymentMethod === 'mercadopago'
  const methodTitle = isMercadoPago ? STRINGS.PAYMENT_MERCADOPAGO : STRINGS.PAYMENT_CASH
  const methodIcon = isMercadoPago ? '💳' : '💵'
  const methodColor = isMercadoPago ? 'blue' : 'green'

  return (
    <Modal {...shell} title={`${methodIcon} ${methodTitle}`}>
        <div className="text-center space-y-5">

          {/* Indicador MP */}
          <div className="flex flex-col items-center gap-1">
            {isMercadoPago && (
              <div className="flex items-center justify-center gap-2 text-xs">
                <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${mpConnected ? 'bg-green-400' : 'bg-red-500'}`} />
                <span className={mpConnected ? 'text-green-400' : 'text-red-400'}>
                  {mpConnected ? 'MercadoPago activo' : 'Sin conexión con MercadoPago'}
                </span>
              </div>
            )}
          </div>

          {/* Referencia: total de la venta (dato secundario) */}
          <div className="text-gray-400 text-sm">
            Total de la venta:&nbsp;
            <span className="text-gray-200 font-semibold">
              ${total.toLocaleString()}
            </span>
            {remainingAmount > 0 && remainingAmount < total && (
              <span className={`ml-3 text-${methodColor}-300 font-semibold`}>
                · Resta: ${remainingAmount.toLocaleString()}
              </span>
            )}
          </div>

          {/* Hero: monto a ingresar */}
          <div className="flex flex-col items-center gap-2">
            <div className="text-base text-gray-300">
              {isMercadoPago ? STRINGS.PAYMENT_AMOUNT_TO_PAY : STRINGS.PAYMENT_CASH_RECEIVED}
            </div>
            <div className={`w-full bg-black border-4 border-${methodColor}-400 py-5 px-6`}>
              <div className={`text-5xl font-mono font-bold text-${methodColor}-300 tracking-wide`}>
                ${paymentInput || '0'}
              </div>
            </div>
            <div className="text-xs text-gray-500">Ingrese el monto y presione ENTER</div>
          </div>

          {/* Pagos parciales ya registrados */}
          {(mpAmount > 0 || cashAmount > 0) && (
            <div className="bg-black border-2 border-gray-600 p-3">
              <div className="text-sm text-gray-300 mb-1">{STRINGS.PAYMENT_MADE}</div>
              <div className="flex justify-center gap-6">
                {mpAmount > 0 && (
                  <div className="text-sm text-blue-400">MP: ${mpAmount.toLocaleString()}</div>
                )}
                {cashAmount > 0 && (
                  <div className="text-sm text-green-400">Efectivo: ${cashAmount.toLocaleString()}</div>
                )}
              </div>
            </div>
          )}

          {/* Vuelto si ya se ingresó más de lo necesario */}
          {change > 0 && (
            <div className={`bg-${isMercadoPago ? 'green' : 'yellow'}-900 border-4 border-${isMercadoPago ? 'green' : 'yellow'}-500 p-4`}>
              <div className={`text-base text-${isMercadoPago ? 'green' : 'yellow'}-300 mb-1`}>
                {isMercadoPago ? STRINGS.PAYMENT_RETURN : STRINGS.PAYMENT_CHANGE}
              </div>
              <div className={`text-3xl font-bold text-${isMercadoPago ? 'green' : 'yellow'}-400`}>
                ${change.toLocaleString()}
              </div>
            </div>
          )}

          {/* Loader durante procesamiento */}
          {isProcessingPayment ? (
            <div className={`bg-${methodColor}-900 border-4 border-${methodColor}-500 p-6`}>
              <div className="flex items-center justify-center space-x-3">
                <div className={`animate-spin rounded-full h-8 w-8 border-b-2 border-${methodColor}-400`}></div>
                <div className={`text-${methodColor}-400 font-bold`}>Procesando pago...</div>
              </div>
            </div>
          ) : (
            <div className="flex justify-center">
              <button
                onClick={onConfirmPayment}
                className={`bg-${methodColor}-600 border-2 border-${methodColor}-400 text-white font-semibold py-2.5 px-8 text-base w-3/5`}
                disabled={!paymentInput || parseFloat(paymentInput) <= 0}
              >
                {STRINGS.BTN_CONFIRM_PAYMENT}
              </button>
            </div>
          )}

          {/* Controles de navegación */}
          <div className="flex justify-center space-x-3">
            <button
              onClick={onBack}
              className="bg-gray-700 border border-gray-500 text-gray-300 py-1.5 px-4 text-sm font-medium"
              disabled={isProcessingPayment}
            >
              {STRINGS.BTN_BACK}
            </button>
            <button
              onClick={onCancel}
              className="bg-red-900 border border-red-700 text-red-300 py-1.5 px-4 text-sm font-medium"
              disabled={isProcessingPayment}
            >
              {STRINGS.BTN_CANCEL}
            </button>
          </div>

          {/* Guía de teclado para pagos */}
          <KeyboardGuide variant="payment" onKeyPress={onKeyPress} />
        </div>
    </Modal>
  )
} 