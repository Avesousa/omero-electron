'use client'

import { useSyncExternalStore } from 'react'
import { getDefaultMoneyLocale, getMoneyLocale, subscribeMoneyLocale, type MoneyLocale } from '@/lib/money'

/** Re-renderiza el componente cuando cambia el formato (por ejemplo, al cargar la configuración del negocio). */
export function useMoneyLocale(): MoneyLocale {
  return useSyncExternalStore(subscribeMoneyLocale, getMoneyLocale, getDefaultMoneyLocale)
}
