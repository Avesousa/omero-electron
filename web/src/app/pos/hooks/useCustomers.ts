import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchCustomers, quickCreateCustomer } from '@/lib/customersApi'
import type { Customer } from '@/shared/types/credit'

/**
 * Clientes activos del POS (GET /api/customers?onlyActive=true) con su deuda vigente. `enabled=false` no pide nada
 * (usuarios sin `POS_CREDITO_USAR`). `refresh()` se llama al abrir los selectores y después de cobrar/fiar.
 */
export function useCustomers(enabled = true) {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const seq = useRef(0)

  const refresh = useCallback(async () => {
    if (!enabled) return
    const mine = ++seq.current
    setLoading(true)
    const r = await fetchCustomers(true)
    if (mine !== seq.current) return // llegó una respuesta más nueva
    if (r.success) { setCustomers(r.data); setError('') } else setError(r.error)
    setLoading(false)
  }, [enabled])

  useEffect(() => { void refresh() }, [refresh])

  /** Alta rápida: todo opcional (sin nombre queda «Cliente <código>»). Devuelve el cliente o el error en español. */
  const quickCreate = useCallback(async (name?: string): Promise<{ customer?: Customer; error?: string }> => {
    const n = name?.trim()
    const r = await quickCreateCustomer(n ? { name: n } : {})
    if (!r.success) return { error: r.error }
    setCustomers(prev => (prev.some(c => c.id === r.data.id) ? prev : [...prev, r.data]))
    return { customer: r.data }
  }, [])

  return { customers, loading, error, refresh, quickCreate }
}
