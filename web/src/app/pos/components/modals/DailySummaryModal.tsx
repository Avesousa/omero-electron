'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/apiClient'
import { Modal } from '@/app/components/ui/Modal'

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

const fmt = (n: number) =>
  n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 })

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
      tone="dark"
      accent="primary"
      size="md"
      title="Resumen del día"
      footer={<span className="text-gray-500 text-sm w-full text-center">Esc para cerrar</span>}
    >
      {loading && (
        <div className="text-center text-gray-400 py-12 text-xl">Cargando...</div>
      )}

      {!loading && summary && (() => {
        const cigarrillo = summary.salesByBusiness.find(b =>
          b.business.toLowerCase().includes('cigarro') ||
          b.business.toLowerCase().includes('cigarrillo')
        )
        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Stat label="Total ventas" value={fmt(summary.totalAmount)} color="text-green-400" />
            <Stat label="Total efectivo" value={fmt(summary.totalCash)} color="text-yellow-400" />
            <Stat label="Total MercadoPago" value={fmt(summary.totalMP)} color="text-cyan-400" />
            <Stat label="Total gastos" value={fmt(summary.totalExpenses)} color="text-red-400" />
            {cigarrillo && (
              <Stat label={`Ventas ${cigarrillo.business}`} value={fmt(cigarrillo.amount)} color="text-purple-400" />
            )}
          </div>
        )
      })()}
    </Modal>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="o-row p-4">
      <div className="text-xs text-gray-400 mb-1">{label}</div>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
    </div>
  )
}
