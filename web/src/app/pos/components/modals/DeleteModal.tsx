import type { CartItem } from '../../types'
import { lineQuantityLabel } from '../../lib/cartLines'
import { STRINGS } from '../../constants/strings'
import { KeyboardGuide } from '../keyboard/KeyboardGuide'
import { Modal } from '@/app/components/ui/Modal'
import { formatMoney } from '@/lib/money'

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

  const common = { isOpen: true as const, onClose, closeOnEsc: false, accent: 'brand' as const, size: 'full' as const }

  if (showClearConfirmation) {
    return (
      <Modal {...common} size="md" accent="danger" title={STRINGS.DELETE_CLEAR_TITLE} hideClose>
        <div className="text-center py-2">
          <div className="mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-[28px] bg-[var(--pos-danger-soft)] text-5xl">🗑️</div>
          <div className="mb-6 text-lg font-semibold text-[var(--pos-ink-2)]">
            {STRINGS.DELETE_CLEAR_SUBTITLE} {cart.length} {STRINGS.CART_ITEMS_COUNT}
          </div>
          <div className="space-y-3">
            <button onClick={onClearAll} className="o-btn o-btn-danger w-full !rounded-2xl !py-4 !text-lg">
              {STRINGS.DELETE_CLEAR_CONFIRM}
            </button>
            <button onClick={onCancelClear} className="o-btn o-btn-secondary w-full !rounded-2xl">
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
          <div className="mb-3 text-sm text-[var(--pos-muted)]">
            <div>{STRINGS.DELETE_INSTRUCTION_1}</div>
            <div>{STRINGS.DELETE_INSTRUCTION_2}</div>
          </div>
          <KeyboardGuide variant="delete" onKeyPress={onKeyPress} />
        </div>
      }
    >
      {/* Índice a eliminar */}
      <div className="mb-5 flex items-center justify-end gap-3">
        <div className="pos-eyebrow">{STRINGS.DELETE_INDEX_LABEL}</div>
        <div className="min-w-[72px] rounded-2xl border-2 border-[var(--pos-danger)] bg-[var(--pos-danger-soft)] px-4 py-2">
          <div className="pos-num text-center text-2xl font-extrabold text-[var(--pos-danger)]">{deleteInput || '---'}</div>
        </div>
      </div>

      {/* Productos ocupando todo el ancho */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
        {[...cart].reverse().map((item, reverseIndex) => (
          <div key={item.id} className="pos-line !flex-col !items-stretch !gap-1 !p-3 hover:!border-[var(--pos-danger)]">
            <div className="pos-line-idx mx-auto mb-1">
              {reverseIndex + 1}
            </div>
            <div className="text-[var(--pos-ink)] font-semibold text-sm text-center truncate">{item.name}</div>
            <div className="text-[var(--pos-muted)] text-xs text-center">{STRINGS.PRODUCT_QUANTITY} {lineQuantityLabel(item)}</div>
            <div className="pos-num text-[var(--pos-primary)] font-extrabold text-sm text-center">{formatMoney(item.total)}</div>
          </div>
        ))}
      </div>
    </Modal>
  )
}
