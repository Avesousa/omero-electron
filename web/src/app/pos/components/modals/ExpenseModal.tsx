import { KeyboardGuide } from '../keyboard/KeyboardGuide'
import { Modal, ModalButton } from '@/app/components/ui/Modal'

interface ExpenseModalProps {
  show: boolean
  amount: string
  isProcessing: boolean
  onAmountChange: (amount: string) => void
  onConfirm: () => void
  onCancel: () => void
  onKeyPress?: (key: string) => void
}

export const ExpenseModal = ({
  show,
  amount,
  isProcessing,
  onAmountChange,
  onConfirm,
  onCancel,
  onKeyPress
}: ExpenseModalProps) => {
  if (!show) return null

  return (
    <Modal
      isOpen
      onClose={onCancel}
      closeOnEsc={false}
      hideClose={isProcessing}
      tone="dark"
      accent="danger"
      size="lg"
      title="Registrar gasto"
      footer={
        <>
          <ModalButton variant="secondary" onClick={onCancel} disabled={isProcessing}>⇧ - CANCELAR</ModalButton>
          <ModalButton variant="danger" onClick={onConfirm} disabled={isProcessing || !amount || parseFloat(amount) <= 0}>
            {isProcessing ? 'Registrando gasto...' : 'ENTER - CONFIRMAR GASTO'}
          </ModalButton>
        </>
      }
    >
      <div className="text-center space-y-5">
        {/* Monto Display */}
        <div className="o-row p-6">
          <div className="text-sm text-gray-400 mb-2 tracking-wide">MONTO</div>
          <div className="text-5xl font-mono font-bold text-red-400">${amount || '0'}</div>
        </div>

        <div className="text-sm text-gray-400">Ingrese el monto y presione ENTER para confirmar</div>

        {isProcessing && (
          <div className="flex items-center justify-center space-x-3 text-red-400">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-red-400"></div>
            <div className="font-bold">Registrando gasto...</div>
          </div>
        )}

        {/* Guía de teclado */}
        <KeyboardGuide variant="expense" onKeyPress={onKeyPress} />
      </div>
    </Modal>
  )
}
