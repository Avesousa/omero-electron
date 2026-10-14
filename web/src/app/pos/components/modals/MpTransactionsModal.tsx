'use client'

import { useEffect, useState, type RefObject } from 'react'
import { apiFetch } from '@/lib/apiClient'
import { mpPaymentLabel, type MpTransaction } from '@/shared/types/mercadopago'
import { useTenantTimeZone, formatTimeTz } from '@/lib/tenantTime'
import { Modal } from '@/app/components/ui/Modal'
import { formatMoney } from '@/lib/money'

interface Props {
  show: boolean
  listRef: RefObject<HTMLDivElement>
  /** Opcional: habilita la X (en POS se cierra con el teclado). */
  onClose?: () => void
}

const fmt = (n: number) => formatMoney(n)

const fmtTime = (iso: string) => formatTimeTz(iso)

/** Read-only list of today's MercadoPago transactions and the sale each one belongs to. */
export function MpTransactionsModal({ show, listRef, onClose }: Props) {
  useTenantTimeZone() // re-render al conocerse la zona del tenant (fmtTime la lee)
  const [transactions, setTransactions] = useState<MpTransaction[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!show) return
    setLoading(true)
    setError(null)
    apiFetch<MpTransaction[]>('/api/mercadopago/transactions').then(res => {
      if (res.success) setTransactions(res.data)
      else setError(res.error)
      setLoading(false)
    })
  }, [show])

  if (!show) return null

  return (
    <Modal
      isOpen
      onClose={onClose ?? (() => {})}
      hideClose={!onClose}
      closeOnEsc={false}
     
      accent="info"
      size="lg"
      title="Transacciones MercadoPago (hoy)"
      subtitle={`${transactions.length} movimientos`}
      flush
      footer={<span className="pos-muted text-sm w-full text-center"><span className="pos-kbd is-light">↑</span> <span className="pos-kbd is-light">↓</span> para desplazar · <span className="pos-kbd is-light">Esc</span> para cerrar</span>}
    >
      {/* listRef debe ser el contenedor con scroll (el teclado del POS lo desplaza con scrollBy) */}
      <div ref={listRef} className="p-4 sm:p-5 overflow-y-auto max-h-[calc(100dvh-12rem)]">
        {loading && <div className="text-center pos-muted py-12 text-xl">Cargando...</div>}
        {error && <div className="text-center pos-danger py-12 text-lg">{error}</div>}
        {!loading && !error && transactions.length === 0 && (
          <div className="text-center pos-muted py-12 text-lg">Sin transacciones hoy</div>
        )}

        {!loading && !error && transactions.length > 0 && (
          <div className="space-y-2">
            {transactions.map(t => (
              <div key={t.id} className="pos-line justify-between">
                <div>
                  <div className="text-xl font-extrabold pos-num pos-ink">{fmt(t.amount)}</div>
                  <div className="text-xs pos-muted mt-0.5">
                    {fmtTime(t.occurredAt)} · {mpPaymentLabel(t.paymentTypeId)}
                    {t.direction === 'OUTGOING' && ' · Saliente'}
                  </div>
                </div>
                {t.saleId !== null ? (
                  <div className="text-right">
                    <span className="pos-chip is-ok">Venta #{t.saleId}</span>
                    {t.saleTotal !== null && <div className="text-xs pos-muted pos-num mt-1">{fmt(t.saleTotal)}</div>}
                  </div>
                ) : (
                  <span className="pos-chip is-warn">Sin venta</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}
