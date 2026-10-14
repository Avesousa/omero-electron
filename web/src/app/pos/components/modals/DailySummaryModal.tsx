'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/apiClient'
import { Modal } from '@/app/components/ui/Modal'
import { formatMoney } from '@/lib/money'

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
  totalProfit: number
  totalProductsSold: number
  totalExpenses: number
  totalTaxes: number
  netRevenue: number
  topProducts: { id: string; name: string; quantity: number; total: number }[]
  lowStockProducts: { id: string; name: string; code: string; stock: number; minStock: number; category: string | null }[]
  salesByBusiness: BusinessSummary[]
  expensesByType: ExpenseGroup[]
}

interface Props {
  show: boolean
  onClose: () => void
}

const fmt = (n: number) => formatMoney(n)

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
            <Stat label="Total efectivo" value={fmt(summary.totalCash)} color="pos-success" />
            <Stat label="Total MercadoPago" value={fmt(summary.totalMP)} color="text-[var(--pos-mp)]" />
            <Stat label="Total gastos" value={fmt(summary.totalExpenses)} color="pos-danger" />
            {cigarrillo && (
              <Stat label={`Ventas ${cigarrillo.business}`} value={fmt(cigarrillo.amount)} color="pos-primary" />
            )}
          </div>
        )
      })()}
    </Modal>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="pos-card-2 p-5">
      <div className="pos-eyebrow mb-2">{label}</div>
      <div className={`text-3xl font-extrabold pos-num ${color}`}>{value}</div>
    </div>
  )
}
