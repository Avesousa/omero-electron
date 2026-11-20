'use client'

import { useEffect, useState, type RefObject } from 'react'
import { apiFetch } from '@/lib/apiClient'
import { friendlyError } from '@/lib/apiErrors'
import { mpPaymentLabel, type MpLink, type MpTransaction } from '@/shared/types/mercadopago'
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

/** Venta o cobro de crédito al que está vinculada una parte: "Cobro #7 Juan Pérez" (sin nombre "Cobro #7"; sin datos "Cobro de crédito"). */
const linkLabel = (l: MpLink) => {
  if (l.targetType === 'SALE') return `Venta #${l.targetId}`
  const name = l.customerName?.trim()
  if (l.customerCode == null) return name ? `Cobro ${name}` : 'Cobro de crédito'
  return name ? `Cobro #${l.customerCode} ${name}` : `Cobro #${l.customerCode}`
}

/** Saldo sin repartir: el del backend; en un backend viejo (sin campos) se deriva de los vínculos. */
const unallocated = (t: MpTransaction): number =>
  t.unallocatedAmount ?? Math.max(0, t.amount - (t.links ?? []).reduce((s, l) => s + l.amount, 0))

/**
 * SOLO LECTURA: transacciones de MercadoPago de hoy y si están relacionadas (a qué venta/cobro y con qué monto, vinculado y
 * sin repartir). Conciliar (vincular, quitar, validar, reiniciar) se hace en el admin de `omero`, no en la caja.
 */
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
      else setError(friendlyError(res.error, 'No se pudieron cargar las transacciones.'))
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
            {transactions.map(t => {
              // `links` ausente = backend viejo: se usa la venta del primer vínculo (`saleId`).
              const links: MpLink[] = t.links ?? []
              const legacySale = links.length === 0 && t.saleId !== null
              const related = links.length > 0 || legacySale
              const free = unallocated(t)
              return (
                <div key={t.id} className="pos-line justify-between" data-testid="mp-tx">
                  <div>
                    <div className="text-xl font-extrabold pos-num pos-ink">{fmt(t.amount)}</div>
                    <div className="text-xs pos-muted mt-0.5">
                      {fmtTime(t.occurredAt)} · {mpPaymentLabel(t.paymentTypeId)}
                      {t.direction === 'OUTGOING' && ' · Saliente'}
                    </div>
                    {links.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5" data-testid="mp-links">
                        {links.map(l => (
                          <span key={l.id} className="pos-chip is-ok">{linkLabel(l)} · <span className="pos-num">{fmt(l.amount)}</span></span>
                        ))}
                      </div>
                    )}
                    {legacySale && <div className="mt-1.5"><span className="pos-chip is-ok">Venta #{t.saleId}{t.saleTotal !== null && <> · <span className="pos-num">{fmt(t.saleTotal)}</span></>}</span></div>}
                  </div>
                  {t.direction === 'INCOMING' ? (
                    <div className="text-right">
                      {!related ? (
                        <span className="pos-chip is-warn">Sin relacionar</span>
                      ) : t.reconciliationStatus === 'PENDING' ? (
                        <span className="pos-chip is-warn">Parcial</span>
                      ) : (
                        <span className="pos-chip is-ok">Relacionada</span>
                      )}
                      {related && links.length > 0 && (
                        <div className="text-xs pos-muted pos-num mt-1">
                          Vinculado {fmt(t.linkedAmount ?? links.reduce((s, l) => s + l.amount, 0))} · Sin repartir {fmt(free)}
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className="pos-chip">Saliente</span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Modal>
  )
}
