'use client'

import { useState } from 'react'
import type { Customer } from '@/shared/types/credit'
import { CustomerList } from './CustomerList'

interface CustomerPickerProps {
  customers: Customer[]
  query: string
  loading?: boolean
  error?: string
  onSelect: (customer: Customer) => void
  /** Alta rápida: solo el nombre (opcional); el backend asigna el código. */
  onQuickCreate: (name: string) => void
  quickBusy?: boolean
}

/** Selector de cliente del cobro a crédito: código numérico con filtrado incremental + alta rápida. */
export function CustomerPicker({ customers, query, loading, error, onSelect, onQuickCreate, quickBusy }: CustomerPickerProps) {
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const hint = customers.length === 1 ? 'Enter para elegirlo' : 'Escribí el código del cliente'
  return (
    <div className="space-y-4 text-left">
      <div className="flex items-center justify-center gap-3">
        <span className="text-sm pos-muted">Código:</span>
        <span className="font-mono text-4xl font-bold pos-accent min-w-[6ch] text-center" data-testid="picker-query">{query || '—'}</span>
      </div>
      <div className="text-center text-xs pos-muted">{hint} · <span className="pos-success font-bold">+</span> cliente nuevo sin nombre</div>
      <div className="max-h-64 overflow-y-auto">
        <CustomerList customers={customers} query={query} loading={loading} error={error} emptyText="No hay clientes cargados." onSelect={onSelect} />
      </div>
      <div className="border-t border-[var(--pos-line)] pt-3">
        {!naming ? (
          <button type="button" className="text-sm pos-success underline font-semibold" onClick={() => setNaming(true)} disabled={quickBusy}>
            + Cliente nuevo con nombre
          </button>
        ) : (
          <form
            className="flex gap-2"
            onSubmit={e => { e.preventDefault(); onQuickCreate(name.trim()); setName(''); setNaming(false) }}
          >
            {/* data-pos-text-input: el teclado del POS deja pasar las teclas a este campo */}
            <input
              className="flex-1 rounded-2xl px-4 py-2 bg-[var(--pos-card-2)] text-[var(--pos-ink)] border border-[var(--pos-line)] outline-none focus:border-[var(--pos-primary-2)]"
              placeholder="Nombre (opcional)"
              aria-label="Nombre del cliente nuevo"
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={100}
              autoFocus
              data-pos-text-input=""
            />
            <button type="submit" className="pos-btn is-primary" disabled={quickBusy}>{quickBusy ? 'Creando...' : 'Crear'}</button>
            <button type="button" className="pos-btn" onClick={() => { setNaming(false); setName('') }}>Cancelar</button>
          </form>
        )}
      </div>
    </div>
  )
}
