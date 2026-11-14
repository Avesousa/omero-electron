import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DailySummaryModal, expenseNote } from './DailySummaryModal'

const apiFetch = vi.fn()
vi.mock('@/lib/apiClient', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }))

const base = {
  salesCount: 2, totalAmount: 20000, totalCash: 10000, totalMP: 10000, totalProfit: 0, totalProductsSold: 2,
  totalExpenses: 0, totalTaxes: 0, netRevenue: 0, topProducts: [], lowStockProducts: [], salesByBusiness: [], expensesByType: [],
}
const cash = { paymentMethodId: 'c', name: 'Efectivo', kind: 'CASH', color: 'green', amount: 10000 }
const mp = { paymentMethodId: 'm', name: 'Mercado Pago', kind: 'MERCADOPAGO', color: 'cyan', amount: 10000,
  generatesExpense: true, expenseRate: 6, expenseAmount: 600, netAmount: 9400 }

const open = async (paymentsByMethod?: unknown[]) => {
  apiFetch.mockResolvedValue({ success: true, data: { ...base, paymentsByMethod } })
  render(<DailySummaryModal show onClose={() => {}} />)
  await waitFor(() => expect(screen.getByText('Total Efectivo')).toBeInTheDocument())
}

describe('DailySummaryModal - gasto por medio de pago', () => {
  beforeEach(() => apiFetch.mockReset())

  it('expenseNote: solo para medios con gasto', () => {
    expect(expenseNote(cash as never)).toBeNull()
    expect(expenseNote({ ...mp, generatesExpense: false } as never)).toBeNull()
    expect(expenseNote({ ...mp, expenseRate: 0 } as never)).toBeNull()
    const n = expenseNote(mp as never)!
    expect(n).toContain('Gasto 6%')
    expect(n).toContain('600')
    expect(n).toContain('Neto')
    expect(n).toContain('9.400')
  })

  it('muestra gasto, neto y leyenda para el medio con gasto', async () => {
    await open([cash, mp])
    expect(screen.getByText(/Gasto 6% \(−.*600.*\) · Neto .*9\.400/)).toBeInTheDocument()
    expect(screen.getByTestId('expense-legend')).toHaveTextContent('comisión configurada')
    expect(screen.getAllByText(/Gasto \d/)).toHaveLength(1)
  })

  it('sin medios con gasto no hay leyenda; backend viejo (sin campos) tampoco rompe', async () => {
    await open([cash, { ...mp, generatesExpense: undefined, expenseRate: undefined, expenseAmount: undefined, netAmount: undefined }])
    expect(screen.queryByTestId('expense-legend')).not.toBeInTheDocument()
    expect(screen.queryByText(/Gasto \d/)).not.toBeInTheDocument()
  })
})
