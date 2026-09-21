import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { OutboxItemView } from '../hooks/useOutboxStatus'
import { OutboxListModal, reasonLabel } from './OutboxListModal'

const item = (over: Partial<OutboxItemView> = {}): OutboxItemView => ({
  clientId: 'c1',
  type: 'SALE',
  status: 'PENDING',
  createdAt: '2026-01-05T10:00:00.000Z',
  attempts: 0,
  lastAttemptAt: null,
  sentAt: null,
  error: null,
  dismissed: false,
  review: null,
  summary: { total: 200, itemCount: 2, products: ['Coca', 'Agua'] },
  ...over,
})

const renderModal = (items: OutboxItemView[], onDismiss = vi.fn(), onClose = vi.fn()) =>
  render(<OutboxListModal isOpen onClose={onClose} items={items} onDismiss={onDismiss} />)

describe('reasonLabel', () => {
  it('traduce los motivos conocidos y deja pasar los desconocidos', () => {
    expect(reasonLabel('PRODUCT_NOT_FOUND')).toBe('Producto no encontrado')
    expect(reasonLabel('CREATED_AT_TOO_OLD')).toMatch(/antigua/)
    expect(reasonLabel('CREATED_AT_IN_FUTURE')).toMatch(/futuro/)
    expect(reasonLabel('OTRO')).toBe('OTRO')
  })
})

describe('<OutboxListModal />', () => {
  it('sin ítems: mensaje vacío', () => {
    renderModal([])
    expect(screen.getByTestId('outbox-empty')).toBeInTheDocument()
  })

  it('cerrado no renderiza nada', () => {
    const { baseElement } = render(<OutboxListModal isOpen={false} onClose={vi.fn()} items={[item()]} onDismiss={vi.fn()} />)
    expect(baseElement).not.toHaveTextContent('Ventas y gastos sin cerrar')
  })

  it('pendiente: resumen de la venta, estado e intentos', () => {
    renderModal([item({ attempts: 3 })])
    expect(screen.getByText(/Venta · 2 ítems \(Coca, Agua\)/)).toBeInTheDocument()
    expect(screen.getByText('Pendiente de subir')).toBeInTheDocument()
    expect(screen.getByText('Intentos: 3')).toBeInTheDocument()
  })

  it('para revisar: muestra los motivos traducidos y NO ofrece descartar', () => {
    renderModal([item({ status: 'REVIEW', review: { reasons: ['PRODUCT_NOT_FOUND', 'CREATED_AT_TOO_OLD'] } })])
    expect(screen.getByText('En revisión del administrador')).toBeInTheDocument()
    expect(screen.getByText(/Producto no encontrado · Fecha de la caja muy antigua/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Entendido' })).not.toBeInTheDocument()
  })

  it('rechazada: muestra el error y "Entendido" descarta ese ítem', () => {
    const onDismiss = vi.fn()
    renderModal([item({ status: 'FAILED', error: 'Cantidad inválida' })], onDismiss)
    expect(screen.getByText('Rechazada')).toBeInTheDocument()
    expect(screen.getByText('Cantidad inválida')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Entendido' }))
    expect(onDismiss).toHaveBeenCalledWith('c1')
  })

  it('los rechazados ya descartados no se listan', () => {
    renderModal([item({ status: 'FAILED', dismissed: true })])
    expect(screen.getByTestId('outbox-empty')).toBeInTheDocument()
  })

  it('un gasto se describe con su descripción y monto; lo más nuevo primero', () => {
    renderModal([
      item({ clientId: 'old', createdAt: '2026-01-01T10:00:00.000Z' }),
      item({ clientId: 'new', type: 'EXPENSE', createdAt: '2026-01-06T10:00:00.000Z', summary: { description: 'Bolsas', amount: 50 } }),
    ])
    const rows = screen.getAllByTestId('outbox-item')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Gasto · Bolsas')
    expect(rows[1]).toHaveTextContent('Venta')
  })

  it('el botón cerrar llama a onClose', () => {
    const onClose = vi.fn()
    renderModal([], vi.fn(), onClose)
    fireEvent.click(screen.getByRole('button', { name: /CERRAR/ }))
    expect(onClose).toHaveBeenCalled()
  })
})
