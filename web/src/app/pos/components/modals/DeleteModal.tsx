import type { CartItem } from '../../types'
import { STRINGS } from '../../constants/strings'
import { KeyboardGuide } from '../keyboard/KeyboardGuide'
import { Modal } from '@/app/components/ui/Modal'

interface DeleteModalProps {
  show: boolean
  cart: CartItem[]
  deleteInput: string
  showClearConfirmation: boolean
  onClose: () => void
  onClearAll: () => void
  onCancelClear: () => void
  onKeyPress?: (key: string) => void
}

export const DeleteModal = ({
  show,
  cart,
  deleteInput,
  showClearConfirmation,
  onClose,
  onClearAll,
  onCancelClear,
  onKeyPress
}: DeleteModalProps) => {
  if (!show) return null

  const common = { isOpen: true as const, onClose, closeOnEsc: false, tone: 'dark' as const, accent: 'brand' as const, size: 'full' as const }

  if (showClearConfirmation) {
    return (
      <Modal {...common} size="md" accent="danger" title={STRINGS.DELETE_CLEAR_TITLE} hideClose>
        <div className="text-center py-2">
          <div className="text-6xl mb-4">🗑️</div>
          <div className="text-lg text-gray-300 mb-6">
            {STRINGS.DELETE_CLEAR_SUBTITLE} {cart.length} {STRINGS.CART_ITEMS_COUNT}
          </div>
          <div className="space-y-3">
            <button onClick={onClearAll} className="o-btn o-btn-danger w-full !py-4 !text-lg">
              {STRINGS.DELETE_CLEAR_CONFIRM}
            </button>
            <button onClick={onCancelClear} className="o-btn o-btn-secondary w-full">
              {STRINGS.DELETE_CLEAR_CANCEL}
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      {...common}
      title={STRINGS.DELETE_TITLE}
      subtitle={`Total: ${cart.length} ${STRINGS.CART_ITEMS_COUNT}`}
      footer={
        <div className="w-full text-center">
          <div className="text-sm text-gray-300 mb-2">
            <div>{STRINGS.DELETE_INSTRUCTION_1}</div>
            <div>{STRINGS.DELETE_INSTRUCTION_2}</div>
          </div>
          <KeyboardGuide variant="delete" onKeyPress={onKeyPress} />
        </div>
      }
    >
      {/* Índice a eliminar */}
      <div className="flex items-center justify-end gap-3 mb-4">
        <div className="text-xs text-gray-400">{STRINGS.DELETE_INDEX_LABEL}</div>
        <div className="o-row px-3 py-2 min-w-[60px]">
          <div className="text-xl font-mono font-bold text-purple-400 text-center">{deleteInput || '---'}</div>
        </div>
      </div>

      {/* Productos ocupando todo el ancho */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2">
        {[...cart].reverse().map((item, reverseIndex) => (
          <div key={item.id} className="o-row p-2 flex flex-col">
            <div className="w-6 h-6 rounded-full bg-purple-600 text-white font-bold flex items-center justify-center text-xs mx-auto mb-1">
              {reverseIndex + 1}
            </div>
            <div className="text-white font-medium text-xs text-center truncate mb-1">{item.name}</div>
            <div className="text-gray-400 text-xs text-center mb-1">{STRINGS.PRODUCT_QUANTITY} {item.quantity}</div>
            <div className="text-green-400 font-bold text-xs text-center">${item.total.toLocaleString()}</div>
          </div>
        ))}
      </div>
    </Modal>
  )
}
