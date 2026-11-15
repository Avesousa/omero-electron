import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchActivePaymentMethods } from '@/lib/paymentMethodsApi'
import { FALLBACK_PAYMENT_METHODS, checkoutMethods, type PaymentMethod } from '@/shared/constants/paymentMethods'

const sorted = (list: readonly PaymentMethod[]) => [...list].sort((a, b) => a.sortOrder - b.sortOrder || a.shortcutKey - b.shortcutKey)

/**
 * Medios de pago activos del cobro. Mientras no se pudieron cargar (o si el backend todavía no los soporta) se usan
 * Efectivo y MercadoPago con las teclas de siempre, así el cobro nunca queda sin opciones.
 */
export function usePaymentMethods(canCredit = false) {
  const [all, setMethods] = useState<PaymentMethod[]>(() => sorted(FALLBACK_PAYMENT_METHODS))
  // Sin POS_CREDITO_USAR el crédito nunca llega a la UI, ni desde un snapshot offline tomado con otro usuario.
  const methods = useMemo(() => checkoutMethods(all, { canCredit }), [all, canCredit])

  const refresh = useCallback(async () => {
    try {
      const r = await fetchActivePaymentMethods()
      if (r.success && Array.isArray(r.data) && r.data.length > 0) setMethods(sorted(r.data))
    } catch {
      // se conserva la última lista conocida
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  return { methods, refresh }
}
