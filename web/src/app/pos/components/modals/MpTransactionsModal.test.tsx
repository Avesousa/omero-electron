import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MpTransactionsModal } from './MpTransactionsModal'

const apiFetch = vi.fn()
vi.mock('@/lib/apiClient', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }))

const base = { direction: 'INCOMING', mpStatus: 'approved', paymentTypeId: 'bank_transfer', operationType: null, source: 'WEBHOOK', occurredAt: '2026-01-01T10:00:00Z', saleId: null, saleTotal: null, note: null }
const link = (id: string, targetType: string, targetId: string, amount: number) => ({ id, transactionId: 't', targetType, targetId, amount, createdAt: '' })

const open = async (data: unknown[]) => {
  apiFetch.mockResolvedValue({ success: true, data })
  render(<MpTransactionsModal show listRef={{ current: null }} />)
  await waitFor(() => expect(screen.queryByText('Cargando...')).not.toBeInTheDocument())
}

describe('MpTransactionsModal (solo lectura)', () => {
  beforeEach(() => apiFetch.mockReset())

  it('solo consulta GET /api/mercadopago/transactions', async () => {
    await open([])
    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect(apiFetch.mock.calls[0]).toEqual(['/api/mercadopago/transactions'])
    expect(screen.getByText('Sin transacciones hoy')).toBeInTheDocument()
  })

  it('transacción repartida entre una venta y un cobro: vínculos, vinculado y sin repartir', async () => {
    await open([{ ...base, id: 'a', amount: 1000, reconciliationStatus: 'PENDING', links: [link('1', 'SALE', '11', 600), link('2', 'CREDIT_PAYMENT', 'cp-1', 300)], linkedAmount: 900, unallocatedAmount: 100 }])
    const row = screen.getByTestId('mp-tx')
    expect(row).toHaveTextContent('Venta #11')
    expect(row).toHaveTextContent('Cobro de crédito')
    expect(row).toHaveTextContent(/Vinculado.*900.*Sin repartir.*100/)
    expect(row).toHaveTextContent('Parcial')
  })

  it('chip del cobro de crédito: con nombre, sin nombre y backend viejo', async () => {
    const cp = (id: string, extra: object) => ({ ...link(id, 'CREDIT_PAYMENT', 'cp-' + id, 4500), ...extra })
    await open([
      { ...base, id: 'a', amount: 4500, reconciliationStatus: 'MATCHED', links: [cp('1', { customerCode: 7, customerName: 'Juan Pérez' })], linkedAmount: 4500, unallocatedAmount: 0 },
      { ...base, id: 'b', amount: 4500, reconciliationStatus: 'MATCHED', links: [cp('2', { customerCode: 8, customerName: null })], linkedAmount: 4500, unallocatedAmount: 0 },
      { ...base, id: 'c', amount: 4500, reconciliationStatus: 'MATCHED', links: [cp('3', {})], linkedAmount: 4500, unallocatedAmount: 0 },
    ])
    const [a, b, c] = screen.getAllByTestId('mp-links')
    expect(a).toHaveTextContent(/^Cobro #7 Juan Pérez · .*4\.500/)
    expect(b).toHaveTextContent(/^Cobro #8 · .*4\.500/)
    expect(b).not.toHaveTextContent('null')
    expect(c).toHaveTextContent(/^Cobro de crédito · .*4\.500/)
  })

  it('conciliada completa y sin relacionar', async () => {
    await open([
      { ...base, id: 'a', amount: 500, reconciliationStatus: 'MATCHED', links: [link('1', 'SALE', '5', 500)], linkedAmount: 500, unallocatedAmount: 0 },
      { ...base, id: 'b', amount: 200, reconciliationStatus: 'PENDING', links: [], linkedAmount: 0, unallocatedAmount: 200 },
    ])
    const [a, b] = screen.getAllByTestId('mp-tx')
    expect(a).toHaveTextContent('Relacionada')
    expect(b).toHaveTextContent('Sin relacionar')
  })

  it('backend viejo (sin links): usa saleId; sin saleId queda sin relacionar', async () => {
    await open([
      { ...base, id: 'a', amount: 500, reconciliationStatus: 'MATCHED', saleId: 9, saleTotal: 500 },
      { ...base, id: 'b', amount: 200, reconciliationStatus: 'PENDING' },
    ])
    const [a, b] = screen.getAllByTestId('mp-tx')
    expect(a).toHaveTextContent('Venta #9')
    expect(b).toHaveTextContent('Sin relacionar')
  })

  it('sin acciones de conciliación y errores en español', async () => {
    await open([{ ...base, id: 'b', amount: 200, reconciliationStatus: 'PENDING', links: [] }])
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  })

  it('error genérico del backend → texto en español', async () => {
    apiFetch.mockResolvedValue({ success: false, error: 'Error 500' })
    render(<MpTransactionsModal show listRef={{ current: null }} />)
    expect(await screen.findByText('No se pudieron cargar las transacciones.')).toBeInTheDocument()
  })
})
