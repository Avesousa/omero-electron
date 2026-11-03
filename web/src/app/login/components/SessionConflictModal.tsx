'use client'

import { Modal, ModalButton } from '@/app/components/ui/Modal'

interface Props {
  isOpen: boolean
  lastSeenAt?: string
  loading?: boolean
  onCancel: () => void
  onConfirm: () => void
}

function formatLastSeen(iso?: string): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
}

/** Aviso de login cuando ya hay otra sesión web abierta (409 SESSION_ACTIVE). */
export function SessionConflictModal({ isOpen, lastSeenAt, loading = false, onCancel, onConfirm }: Props) {
  const lastSeen = formatLastSeen(lastSeenAt)
  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title="Ya hay una sesión abierta"
      size="sm"
      accent="warning"
      footer={
        <>
          <ModalButton variant="secondary" onClick={onCancel} disabled={loading}>Cancelar</ModalButton>
          <ModalButton variant="primary" onClick={onConfirm} disabled={loading}>Cerrar la otra y continuar</ModalButton>
        </>
      }
    >
      <p>
        Ya tenés una sesión abierta en otro navegador o equipo{lastSeen ? ` (última actividad: ${lastSeen})` : ''}.
        {' '}Si continuás, esa sesión se cerrará y tendrá que ingresar de nuevo.
      </p>
    </Modal>
  )
}
