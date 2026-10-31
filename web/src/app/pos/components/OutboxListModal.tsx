import { Modal, ModalButton } from '@/app/components/ui/Modal'
import type { OutboxItemView } from '../hooks/useOutboxStatus'
import { formatMoney } from '@/lib/money'

const REASON_LABEL: Record<string, string> = {
  PRODUCT_NOT_FOUND: 'Producto no encontrado',
  CREATED_AT_TOO_OLD: 'Fecha de la caja muy antigua',
  CREATED_AT_IN_FUTURE: 'Fecha de la caja en el futuro',
}

export function reasonLabel(code: string): string {
  return REASON_LABEL[code] ?? code
}

const STATUS_LABEL: Record<string, { text: string; className: string }> = {
  PENDING: { text: 'Pendiente de subir', className: 'is-warn' },
  REVIEW: { text: 'En revisión del administrador', className: 'is-warn' },
  FAILED: { text: 'Rechazada', className: 'is-bad' },
  SENT: { text: 'Enviada', className: 'is-ok' },
}

function money(n: number | undefined): string {
  return typeof n === 'number' ? formatMoney(n) : ''
}

function describe(item: OutboxItemView): string {
  if (item.type === 'EXPENSE') return `Gasto${item.summary.description ? ` · ${item.summary.description}` : ''} ${money(item.summary.amount)}`.trim()
  const products = (item.summary.products ?? []).filter(Boolean).join(', ')
  const count = item.summary.itemCount ?? 0
  return `Venta · ${count} ítem${count !== 1 ? 's' : ''}${products ? ` (${products}${count > 3 ? '…' : ''})` : ''} · ${money(item.summary.total)}`
}

interface Props {
  isOpen: boolean
  onClose: () => void
  items: OutboxItemView[]
  onDismiss: (clientId: string) => void
}

/**
 * Ventas y gastos del outbox que todavía no están "cerrados": pendientes de subir, marcados para revisión por el
 * backend (un administrador los resuelve en el panel) y rechazados. El cajero solo puede marcar como visto un rechazo.
 */
export function OutboxListModal({ isOpen, onClose, items, onDismiss }: Props) {
  const visible = items.filter(i => !(i.status === 'FAILED' && i.dismissed)).slice().reverse()
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      closeOnEsc={false}
     
      accent="warning"
      size="lg"
      title="Ventas y gastos sin cerrar"
      subtitle="Se guardaron en esta caja. Las pendientes se suben solas al volver la conexión."
      footer={<ModalButton variant="secondary" onClick={onClose}>ESC - CERRAR</ModalButton>}
    >
      {visible.length === 0 ? (
        <div className="text-center text-[var(--pos-muted)] py-6" data-testid="outbox-empty">No hay nada pendiente.</div>
      ) : (
        <ul className="space-y-3" data-testid="outbox-list">
          {visible.map(item => {
            const st = STATUS_LABEL[item.status] ?? STATUS_LABEL.PENDING
            const reasons = item.review?.reasons ?? []
            return (
              <li key={item.clientId} className="pos-card-2 p-3 space-y-1" data-testid="outbox-item">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-[var(--pos-ink-2)]">{new Date(item.createdAt).toLocaleString('es-AR')}</span>
                  <span className={`pos-chip !text-xs !px-2 !py-0.5 ${st.className}`}>{st.text}</span>
                </div>
                <div className="text-base font-semibold text-[var(--pos-ink)]">{describe(item)}</div>
                {reasons.length > 0 && (
                  <div className="text-sm text-[var(--pos-warn)]">Motivo: {reasons.map(reasonLabel).join(' · ')}</div>
                )}
                {item.status === 'FAILED' && item.error && <div className="text-sm text-[var(--pos-danger)]">{item.error}</div>}
                {item.status === 'PENDING' && item.attempts > 0 && (
                  <div className="text-xs text-[var(--pos-muted)]">Intentos: {item.attempts}</div>
                )}
                {item.status === 'FAILED' && (
                  <div className="pt-1">
                    <ModalButton variant="secondary" onClick={() => onDismiss(item.clientId)}>
                      Entendido
                    </ModalButton>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Modal>
  )
}
