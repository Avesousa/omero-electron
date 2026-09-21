'use client'

import { useEffect, useState, type RefObject } from 'react'
import { apiFetch } from '@/lib/apiClient'
import { mpPaymentLabel, type MpTransaction } from '@/shared/types/mercadopago'
import { useTenantTimeZone, formatTimeTz } from '@/lib/tenantTime'
import { Modal } from '@/app/components/ui/Modal'

interface Props {
  show: boolean
  listRef: RefObject<HTMLDivElement>
  /** Opcional: habilita la X (en POS se cierra con el teclado). */
  onClose?: () => void
}

const fmt = (n: number) =>
  n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 })

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
      tone="dark"
      accent="info"
      size="lg"
      title="Transacciones MercadoPago (hoy)"
      subtitle={`${transactions.length} movimientos`}
      flush
      footer={<span className="text-gray-500 text-sm w-full text-center">↑ ↓ para desplazar · Esc para cerrar</span>}
    >
      {/* listRef debe ser el contenedor con scroll (el teclado del POS lo desplaza con scrollBy) */}
      <div ref={listRef} className="p-4 sm:p-5 overflow-y-auto max-h-[calc(100dvh-12rem)]">
        {loading && <div className="text-center text-gray-400 py-12 text-xl">Cargando...</div>}
        {error && <div className="text-center text-red-400 py-12 text-lg">{error}</div>}
        {!loading && !error && transactions.length === 0 && (
          <div className="text-center text-gray-500 py-12 text-lg">Sin transacciones hoy</div>
        )}

        {!loading && !error && transactions.length > 0 && (
          <div className="space-y-2">
            {transactions.map(t => (
              <div key={t.id} className="o-row p-3 flex items-center justify-between gap-4">
                <div>
                  <div className="text-xl font-bold text-green-400">{fmt(t.amount)}</div>
                  <div className="text-xs text-gray-400">
                    {fmtTime(t.occurredAt)} · {mpPaymentLabel(t.paymentTypeId)}
                    {t.direction === 'OUTGOING' && ' · Saliente'}
                  </div>
                </div>
                {t.saleId !== null ? (
                  <div className="text-right">
                    <div className="text-green-400 font-bold">Venta #{t.saleId}</div>
                    {t.saleTotal !== null && <div className="text-xs text-gray-400">{fmt(t.saleTotal)}</div>}
                  </div>
                ) : (
                  <div className="text-yellow-400 font-bold">Sin venta</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}
