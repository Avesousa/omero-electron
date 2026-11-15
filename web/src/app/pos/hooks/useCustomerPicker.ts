import { useCallback, useMemo, useState } from 'react'
import type { Customer } from '@/shared/types/credit'
import { filterCustomersByCode, singleMatch } from '../utils/credit'

/**
 * Filtro incremental por código para los selectores de cliente del POS (pensado para teclado numérico):
 * dígitos filtran, Backspace borra, Enter selecciona si queda uno solo.
 */
export function useCustomerPicker(customers: readonly Customer[]) {
  const [query, setQuery] = useState('')
  const matches = useMemo(() => filterCustomersByCode(customers, query), [customers, query])
  const single = useMemo(() => singleMatch(matches), [matches])

  const reset = useCallback(() => setQuery(''), [])

  /** Procesa una tecla; devuelve el cliente si Enter lo seleccionó. */
  const pressKey = useCallback((key: string): Customer | null => {
    if (/^\d$/.test(key)) { setQuery(q => q + key); return null }
    if (key === 'Backspace') { setQuery(q => q.slice(0, -1)); return null }
    if (key === 'Enter') return single
    return null
  }, [single])

  return { query, setQuery, matches, single, reset, pressKey }
}
