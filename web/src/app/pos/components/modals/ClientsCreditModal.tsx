'use client'

import type { Customer } from '@/shared/types/credit'
import { Modal } from '@/app/components/ui/Modal'
import { KeyboardGuide } from '../keyboard/KeyboardGuide'
import { CustomerList } from './CustomerList'

interface ClientsCreditModalProps {
  show: boolean
  /** Clientes ya filtrados por el código tipeado (solo los que deben dinero). */
  customers: Customer[]
  searchQuery: string
  loading?: boolean
  error?: string
  /** Mientras se cargan las líneas pendientes del cliente elegido. */
  selecting?: boolean
  onSelect: (customer: Customer) => void
  onClose: () => void
  onKeyPress?: (key: string) => void
}

/**
 * «Clientes con crédito» (estilo ProductsModal): clientes con deuda, filtrados al tipear dígitos (código). Si queda uno
 * solo, Enter lo selecciona (lo resuelve la página con `useCustomerPicker`); también se puede hacer click.
 */
export const ClientsCreditModal = ({ show, customers, searchQuery, loading, error, selecting, onSelect, onClose, onKeyPress }: ClientsCreditModalProps) => {
  if (!show) return null
  return (
    <Modal
      isOpen
      onClose={onClose}
      closeOnEsc={false}
     
      accent="brand"
      size="lg"
      title="Clientes con crédito"
      subtitle={`${customers.length} ${customers.length === 1 ? 'cliente con deuda' : 'clientes con deuda'}`}
      footer={
        <div className="w-full text-center">
          <KeyboardGuide variant="clients" onKeyPress={onKeyPress} />
        </div>
      }
    >
      <div className="mb-3 flex items-center gap-3">
        <span className="text-sm pos-muted">Código:</span>
        <span className="font-mono text-2xl font-bold pos-primary min-w-[6ch]" data-testid="clients-query">{searchQuery || '—'}</span>
        {selecting && <span className="text-sm pos-muted">Cargando deuda...</span>}
      </div>
      <CustomerList customers={customers} query={searchQuery} loading={loading} error={error} emptyText="No hay clientes con deuda." onSelect={onSelect} />
    </Modal>
  )
}
