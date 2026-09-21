/**
 * useSales.ts
 *
 * Crea la venta con UN solo intento contra `POST /api/sales`.
 *
 *   desktop → el Next local la guarda primero en el outbox SQLite y responde 201 `{ queued: true }` al instante;
 *             el envío al backend (con reintentos 30 s → 90 s → 270 s → 810 s) lo hace el sender del servidor local.
 *             Por eso acá NO hay reintentos ni cola en localStorage.
 *   web     → va directo al backend: si falla se muestra el error (no se encola nada).
 *
 * El costo NO se envía nunca: el backend lo resuelve al recibir la venta.
 */

import { useState } from 'react'
import type { CartItem } from '../types'
import { apiFetch } from '@/lib/apiClient'

export interface SalePayloadItem {
  productId: string
  productName: string
  quantity: number
  unitPrice: number
  total: number
  promotionId: string | null
  promotionName: string | null
}

export interface SalePayload {
  items: SalePayloadItem[]
  cashAmount: number
  mpAmount: number
  change: number
}

export type SaleResult =
  | { success: true; sale: unknown; queued: boolean }
  | { success: false; error: string }

/**
 * Arma el cuerpo de la venta. Los ítems de precio libre (código '000-xxx') se agrupan en un único ítem '000'.
 * Cada ítem lleva `productName` (snapshot: la venta sigue siendo legible aunque el producto se elimine después).
 */
export function buildSalePayload(items: CartItem[], cashAmount: number, mpAmount: number, change: number): SalePayload {
  const freePriceItems = items.filter(i => i.code.startsWith('000'))
  const regularItems = items.filter(i => !i.code.startsWith('000'))

  const aggregated = [...regularItems]
  if (freePriceItems.length > 0) {
    const totalFreePriceAmount = freePriceItems.reduce((sum, i) => sum + (i.total || 0), 0)
    aggregated.push({
      ...freePriceItems[0],
      code: '000',
      quantity: freePriceItems.length,
      price: totalFreePriceAmount,
      total: totalFreePriceAmount,
    })
  }

  return {
    items: aggregated.map(item => ({
      productId: item.code,
      productName: item.name,
      quantity: item.quantity,
      unitPrice: item.price,
      total: item.total,
      promotionId: item.promotionId || null,
      promotionName: item.promotionName || null,
    })),
    cashAmount,
    mpAmount,
    change,
  }
}

export const useSales = () => {
  const [isProcessing, setIsProcessing] = useState(false)

  const createSale = async (
    items: CartItem[],
    cashAmount: number = 0,
    mpAmount: number = 0,
    change: number = 0
  ): Promise<SaleResult> => {
    setIsProcessing(true)
    try {
      const result = await apiFetch<{ queued?: boolean } | null>('/api/sales', {
        method: 'POST',
        body: JSON.stringify(buildSalePayload(items, cashAmount, mpAmount, change)),
      })
      if (result.success) {
        return { success: true, sale: result.data, queued: result.data?.queued === true }
      }
      return { success: false, error: result.error || 'Error al procesar la venta' }
    } catch {
      // fetch lanzó: el servidor (local o remoto) no respondió
      return { success: false, error: 'No se pudo conectar. La venta no se registró.' }
    } finally {
      setIsProcessing(false)
    }
  }

  return { createSale, isProcessing }
}
