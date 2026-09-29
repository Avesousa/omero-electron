import { Modal, ModalAlert, ModalButton } from '@/app/components/ui/Modal'
import { SALE_BLOCKED_MESSAGE } from '@/lib/entitlement/rule'

interface Props {
  isOpen: boolean
  /** Vuelve a consultar el entitlement (también se hace solo cada 30 s). */
  onRetry: () => void
  onLogout: () => void
}

/**
 * Pantalla bloqueante del POS cuando el negocio no tiene suscripción activa. NO revoca la caja ni borra la sesión: las
 * ventas ya hechas siguen subiendo en segundo plano y el POS se desbloquea solo cuando vuelve el acceso.
 */
export function SubscriptionBlockedScreen({ isOpen, onRetry, onLogout }: Props) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {}}
      hideClose
      closeOnEsc={false}
      tone="dark"
      size="sm"
      accent="danger"
      zIndex={2000}
      title="Sin suscripción activa"
      footer={
        <>
          <ModalButton variant="secondary" onClick={onLogout}>
            Cerrar sesión
          </ModalButton>
          <ModalButton variant="primary" onClick={onRetry}>
            Reintentar
          </ModalButton>
        </>
      }
    >
      <div data-testid="subscription-blocked" className="space-y-3">
        <ModalAlert kind="error">{SALE_BLOCKED_MESSAGE}</ModalAlert>
        <p className="text-sm opacity-80">
          Las ventas ya registradas en esta caja se siguen subiendo. El POS se desbloquea solo cuando el negocio regulariza su suscripción.
        </p>
      </div>
    </Modal>
  )
}
