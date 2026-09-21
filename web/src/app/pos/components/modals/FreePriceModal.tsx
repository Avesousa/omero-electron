'use client'

import { Modal, ModalButton } from '@/app/components/ui/Modal'

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
      tone="dark"
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
        <p className="text-gray-400 text-sm mb-4">Ingresá el precio del producto</p>
        <div className="text-5xl font-bold text-white mb-2">
          ${price > 0 ? price.toLocaleString('es-AR') : '—'}
        </div>
        <p className="text-gray-500 text-xs">Usá el teclado numérico para ingresar el monto</p>
      </div>
    </Modal>
  )
}
