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
  if (!isOpen) return null
  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4 bg-[var(--pos-bg)]"
      style={{ zIndex: 2000 }}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="subscription-blocked-title"
    >
      <div data-testid="subscription-blocked" className="pos-card w-full max-w-md p-8 text-center space-y-4">
        <div className="pos-empty-icon mx-auto" aria-hidden="true">🔒</div>
        <h2 id="subscription-blocked-title" className="text-2xl font-extrabold text-[var(--pos-ink)]">
          Sin suscripción activa
        </h2>
        <p className="pos-chip is-bad !rounded-2xl !text-sm !whitespace-normal">{SALE_BLOCKED_MESSAGE}</p>
        <p className="text-sm text-[var(--pos-muted)]">
          Las ventas ya registradas en esta caja se siguen subiendo. El POS se desbloquea solo cuando el negocio regulariza su suscripción.
        </p>
        <div className="flex flex-col gap-3 pt-2">
          <button type="button" className="pos-btn is-accent w-full" onClick={onRetry}>
            Reintentar
          </button>
          <button type="button" className="pos-btn w-full" onClick={onLogout}>
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  )
}
