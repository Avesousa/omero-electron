import { useCallback, useRef, useState } from 'react'
import { fetchCustomerDetail } from '@/lib/customersApi'
import type { CreditLine, Customer } from '@/shared/types/credit'
import { newClientId, round2 } from '../utils/credit'

/** Cobro de deuda en curso: cliente + sus líneas PENDING (no son productos nuevos: no se envían como items de venta). */
export interface CreditCollectionState {
  customer: Customer
  /** Líneas pendientes en el orden en que se cobrarían (FIFO por fecha de venta). */
  lines: CreditLine[]
  /** Deuda vigente (suma de `debt` de las líneas pendientes, con precios actuales). */
  debt: number
}

/**
 * Carga al proceso de venta las líneas pendientes de un cliente. Mantiene un `clientId` estable por cobro para que
 * reintentar `POST /api/credit/collect` sea idempotente (si ya se registró, el backend responde `duplicate`).
 */
export function useCreditCollection() {
  const [collection, setCollection] = useState<CreditCollectionState | null>(null)
  const [loading, setLoading] = useState(false)
  const clientIdRef = useRef<string>('')

  /** Devuelve null si salió bien o el error en español. */
  const load = useCallback(async (customer: Customer): Promise<string | null> => {
    setLoading(true)
    const r = await fetchCustomerDetail(customer.id)
    setLoading(false)
    if (!r.success) return r.error
    const lines = r.data.lines.filter(l => l.status === 'PENDING')
    const debt = round2(lines.reduce((s, l) => s + l.debt, 0))
    if (lines.length === 0 || debt <= 0) return 'El cliente no tiene deuda pendiente.'
    clientIdRef.current = newClientId()
    setCollection({ customer: r.data.customer ?? customer, lines, debt })
    return null
  }, [])

  const clear = useCallback(() => { setCollection(null); clientIdRef.current = '' }, [])

  /** `clientId` del cobro en curso (se renueva en cada `load`). */
  const getClientId = useCallback(() => clientIdRef.current || (clientIdRef.current = newClientId()), [])

  return { collection, loading, load, clear, getClientId }
}
