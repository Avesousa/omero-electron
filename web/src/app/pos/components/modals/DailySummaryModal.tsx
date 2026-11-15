'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/apiClient'
import { Modal } from '@/app/components/ui/Modal'
import { formatMoney } from '@/lib/money'
import { paymentColor, type PaymentBreakdown } from '@/shared/constants/paymentMethods'
import { collectedRows, creditReferenceRow } from '@/lib/creditSummary'
import type { CreditSummary } from '@/shared/types/credit'

interface BusinessSummary {
  business: string
  amount: number
  profit: number
}

interface ExpenseItem {
  description: string
  amount: number
  count: number
}

interface ExpenseGroup {
  type: string
  total: number
  items: ExpenseItem[]
}

interface DailySummary {
  salesCount: number
  totalAmount: number
  totalCash: number
  totalMP: number
  /** Cobrado por medio de pago. Ausente en backends anteriores a los medios configurables. */
  paymentsByMethod?: PaymentBreakdown[]
  totalProfit: number
  totalProductsSold: number
  totalExpenses: number
  totalTaxes: number
  netRevenue: number
  topProducts: { id: string; name: string; quantity: number; total: number }[]
  lowStockProducts: { id: string; name: string; code: string; stock: number; minStock: number; category: string | null }[]
  salesByBusiness: BusinessSummary[]
  expensesByType: ExpenseGroup[]
  /** Crédito del día: REFERENCIA (no suma a lo cobrado). Ausente en backends sin crédito. */
  credit?: CreditSummary
}

interface Props {
  show: boolean
  onClose: () => void
}

const fmt = (n: number) => formatMoney(n)

/** Gasto configurado del medio sobre lo cobrado. Null si el medio no genera gasto (o el backend es anterior). */
export function expenseNote(p: PaymentBreakdown): string | null {
  if (!p.generatesExpense || !p.expenseRate || p.expenseRate <= 0) return null
  const gasto = p.expenseAmount ?? 0
  const neto = p.netAmount ?? p.amount - gasto
  return `Gasto ${p.expenseRate.toLocaleString('es-AR', { maximumFractionDigits: 2 })}% (−${fmt(gasto)}) · Neto ${fmt(neto)}`
}

export function DailySummaryModal({ show, onClose }: Props) {
  const [summary, setSummary] = useState<DailySummary | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!show) return
    setLoading(true)
    apiFetch<DailySummary>('/api/dashboard/daily-summary?byUser=true').then(res => {
      if (res.success) setSummary(res.data)
      setLoading(false)
    })
  }, [show])

  if (!show) return null

  return (
    <Modal
      isOpen
      onClose={onClose}
      closeOnEsc={false}
     
      accent="primary"
      size="md"
      title="Resumen del día"
      footer={<span className="pos-muted text-sm w-full text-center"><span className="pos-kbd is-light">Esc</span> para cerrar</span>}
    >
      {loading && (
        <div className="text-center pos-muted py-12 text-xl">Cargando...</div>
      )}

      {!loading && summary && (() => {
        const cigarrillo = summary.salesByBusiness.find(b =>
          b.business.toLowerCase().includes('cigarro') ||
          b.business.toLowerCase().includes('cigarrillo')
        )
        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Stat label="Total ventas" value={fmt(summary.totalAmount)} color="pos-ink" />
            {summary.paymentsByMethod
              ? collectedRows(summary.paymentsByMethod).map(p => (
                  <Stat key={p.paymentMethodId} label={`Total ${p.name}`} value={fmt(p.amount)} accent={paymentColor(p.color).bg} note={expenseNote(p)} />
                ))
              : (<>
                  <Stat label="Total efectivo" value={fmt(summary.totalCash)} color="pos-success" />
                  <Stat label="Total MercadoPago" value={fmt(summary.totalMP)} color="text-[var(--pos-mp)]" />
                </>)}
            <Stat label="Total gastos" value={fmt(summary.totalExpenses)} color="pos-danger" />
            <CreditBlock credit={summary.credit} creditRow={creditReferenceRow(summary.paymentsByMethod)} />
            {cigarrillo && (
              <Stat label={`Ventas ${cigarrillo.business}`} value={fmt(cigarrillo.amount)} color="pos-primary" />
            )}
            {summary.paymentsByMethod?.some(p => expenseNote(p)) && (
              <p className="pos-muted text-sm sm:col-span-2" data-testid="expense-legend">
                El gasto es la comisión configurada de cada medio de pago, calculada sobre lo cobrado con ese medio. Neto = cobrado − gasto.
              </p>
            )}
          </div>
        )
      })()}
    </Modal>
  )
}

function Stat({ label, value, color, accent, note }: { label: string; value: string; color?: string; accent?: string; note?: string | null }) {
  return (
    <div className="pos-card-2 p-5">
      <div className="pos-eyebrow mb-2">{label}</div>
      <div className={`text-3xl font-extrabold pos-num ${color ?? ''}`} style={accent ? { color: accent } : undefined}>{value}</div>
      {note && <div className="pos-muted text-sm mt-2">{note}</div>}
    </div>
  )
}

/**
 * Crédito del día, separado de lo cobrado: lo fiado hoy es referencia (no suma al total) y los cobros de crédito
 * (ventas fiadas antes) van en NEGATIVO con su desglose por medio, para cuadrar caja y transferencias.
 */
export function CreditBlock({ credit, creditRow }: { credit?: CreditSummary; creditRow?: PaymentBreakdown }) {
  const issued = credit?.issued ?? creditRow?.amount ?? 0
  const collected = credit?.collected ?? 0
  if (!credit && !creditRow) return null
  if (issued <= 0 && collected <= 0 && !(credit && credit.pending > 0)) return null
  return (
    <div className="sm:col-span-2 pos-card-2 p-5 space-y-3" data-testid="credit-block">
      <div className="pos-eyebrow">Crédito (referencia: no suma a lo cobrado)</div>
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        <div>
          <div className="pos-muted text-sm">Fiado hoy</div>
          <div className="text-2xl font-extrabold pos-primary pos-num" data-testid="credit-issued">{fmt(issued)}</div>
        </div>
        <div>
          <div className="pos-muted text-sm">Cobros de crédito</div>
          <div className="text-2xl font-extrabold pos-danger pos-num" data-testid="credit-collected">{collected > 0 ? `−${fmt(collected)}` : fmt(0)}</div>
        </div>
        {credit && (
          <div>
            <div className="pos-muted text-sm">Deuda pendiente total</div>
            <div className="text-2xl font-extrabold pos-ink pos-num">{fmt(credit.pending)}</div>
          </div>
        )}
      </div>
      {credit && credit.collectionsByMethod.length > 0 && (
        <ul className="text-sm pos-muted flex flex-wrap gap-x-6" data-testid="credit-collections-by-method">
          {credit.collectionsByMethod.map(m => (
            <li key={m.paymentMethodId} style={{ color: paymentColor(m.color).bg }}>{m.name}: −{fmt(m.amount)}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
