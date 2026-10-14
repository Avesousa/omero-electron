'use client'

import { Modal, ModalButton } from '@/app/components/ui/Modal'
import { formatMoney } from '@/lib/money'

interface Props {
  show: boolean
  currentInput: string
  onConfirm: (price: number) => void
  onClose: () => void
}

export function FreePriceModal({ show, currentInput, onConfirm, onClose }: Props) {
  if (!show) return null

  const price = parseFloat(currentInput) || 0

  return (
    <Modal
      isOpen
      onClose={onClose}
      closeOnEsc={false}
     
      accent="warning"
      size="sm"
      title="Precio libre"
      footer={
        <>
          <ModalButton variant="secondary" onClick={onClose}>Esc — Cancelar</ModalButton>
          <ModalButton variant="brand" onClick={() => price > 0 && onConfirm(price)} disabled={price <= 0}>
            Enter — Agregar
          </ModalButton>
        </>
      }
    >
      <div className="text-center py-2">
        <p className="pos-eyebrow mb-3">Ingresá el precio del producto</p>
        <div className="pos-entry !border-[var(--pos-primary-2)] !shadow-[0_0_0_6px_var(--pos-primary-soft)] mb-4">
          <div className="v pos-num !text-[var(--pos-primary)]">
            {price > 0 ? formatMoney(price) : '$ —'}
          </div>
        </div>
        <p className="text-[var(--pos-muted)] text-xs">Usá el teclado numérico para ingresar el monto</p>
      </div>
    </Modal>
  )
}
