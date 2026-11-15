'use client'

import type { Customer } from '@/shared/types/credit'
import { formatMoney } from '@/lib/money'

interface CustomerListProps {
  customers: Customer[]
  /** Texto tipeado (filtro por código): se resalta el prefijo. */
  query: string
  loading?: boolean
  error?: string
  showDebt?: boolean
  emptyText?: string
  onSelect: (customer: Customer) => void
}

/** Lista de clientes (código, nombre, deuda) con filtro por código; si queda uno solo se marca como el que toma Enter. */
export function CustomerList({ customers, query, loading, error, showDebt = true, emptyText = 'No hay clientes.', onSelect }: CustomerListProps) {
  if (loading && customers.length === 0) return <div className="text-center pos-muted py-8">Cargando clientes...</div>
  if (error && customers.length === 0) return <div className="text-center pos-danger py-8" role="alert">{error}</div>
  if (customers.length === 0) return <div className="text-center pos-muted py-8" data-testid="customers-empty">{query ? `Ningún cliente con código ${query}.` : emptyText}</div>
  const only = customers.length === 1
  return (
    <ul className="space-y-2" aria-label="Clientes">
      {customers.map(c => (
        <li key={c.id}>
          <button
            type="button"
            onClick={() => onSelect(c)}
            className={`w-full flex items-center gap-4 text-left pos-card-2 p-3 transition-colors hover:!border-[var(--pos-primary-2)] ${only ? '!border-[var(--pos-success)]' : ''}`}
            data-testid="customer-row"
          >
            <span className="font-mono text-2xl font-bold pos-accent min-w-[4ch] text-right">
              {query && String(c.code).startsWith(query) ? <><span className="pos-ink">{query}</span>{String(c.code).slice(query.length)}</> : c.code}
            </span>
            <span className="flex-1 min-w-0 pos-ink text-lg truncate">{c.name}</span>
            {showDebt && (
              <span className={`font-mono text-lg font-bold ${c.debt > 0 ? 'pos-danger' : 'pos-muted'}`}>{formatMoney(c.debt)}</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  )
}
