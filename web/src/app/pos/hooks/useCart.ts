import { useState, useMemo } from 'react'
import type { CartItem, Product } from '../types'
import { STRINGS } from '../constants/strings'
import { usePromotions } from './usePromotions'
import { isWeightLine, newLineId, unitLine, weightLine } from '../lib/cartLines'
import { lineTotal, roundKg } from '@/lib/quantity'

export const useCart = (showNotification?: (message: string, type: 'success' | 'error' | 'info') => void) => {
  const [rawCart, setRawCart] = useState<CartItem[]>([])
  const { applyPromotions } = usePromotions()

  // Aplicar promociones usando useMemo para evitar re-renders innecesarios
  const cart = useMemo(() => {
    if (rawCart.length === 0) return []
    return applyPromotions(rawCart)
  }, [rawCart, applyPromotions])

  /** Agrega unidades. Las líneas por unidad de un mismo producto se acumulan en una sola. */
  const addToCart = (product: Product, quantity: number) => {
    setRawCart(prev => {
      const existingItem = prev.find(item => item.code === product.code && !isWeightLine(item))
      // Si existe, se remueve de su posición y se agrega al final con la nueva cantidad
      const line = existingItem
        ? unitLine(product, existingItem.quantity + quantity, existingItem.originalPrice)
        : unitLine(product, quantity)
      return [...prev.filter(item => item !== existingItem), line]
    })

    if (showNotification) {
      showNotification(`${STRINGS.NOTIF_PRODUCT_ADDED} ${product.name}`, 'success')
    }
  }

  /**
   * Agrega una pesada: siempre es una línea nueva (dos pesadas del mismo producto son dos líneas).
   * `labelTotal` = importe impreso en la etiqueta de la balanza, si lo trae.
   */
  const addWeightToCart = (product: Product, weightKg: number, labelTotal?: number) => {
    setRawCart(prev => [...prev, weightLine(product, weightKg, labelTotal)])
    if (showNotification) {
      showNotification(`${STRINGS.NOTIF_PRODUCT_ADDED} ${product.name}`, 'success')
    }
  }

  /** Corrige el peso de una pesada ya cargada (el importe se recalcula con el precio por kg). */
  const updateCartItemWeight = (lineId: string, weightKg: number) => {
    setRawCart(prev => prev.map(item => {
      if (item.id !== lineId || !isWeightLine(item)) return item
      const quantity = roundKg(weightKg)
      const price = item.originalPrice || item.price || 0
      return { ...item, id: newLineId(), quantity, price, total: lineTotal(quantity, price), fixedTotal: undefined }
    }))
  }

  const removeFromCart = (index: number) => {
    const item = cart[index]
    if (item) {
      setRawCart(prev => prev.filter((_, i) => i !== index))
      if (showNotification) {
        showNotification(`${STRINGS.NOTIF_PRODUCT_DELETED} ${item.name}`, 'info')
      }
      return true
    }
    return false
  }

  /** Cambia la cantidad de la línea por unidad de un producto (las pesadas se corrigen con `updateCartItemWeight`). */
  const updateCartItemQuantity = (productCode: string, newQuantity: number) => {
    setRawCart(prev => {
      const existingItem = prev.find(item => item.code === productCode && !isWeightLine(item))
      if (!existingItem) return prev

      const itemPrice = existingItem.originalPrice || existingItem.price || 0
      const updatedItem: CartItem = {
        ...existingItem,
        id: newLineId(), // Nuevo ID para forzar re-render
        price: itemPrice,
        quantity: newQuantity,
        total: lineTotal(newQuantity, itemPrice),
        originalPrice: itemPrice,
      }
      // Remover el item existente y agregar el actualizado al final
      return [...prev.filter(item => item !== existingItem), updatedItem]
    })
  }

  const clearCart = () => {
    setRawCart([])
    if (showNotification) {
      showNotification(STRINGS.NOTIF_CART_CLEARED, 'success')
    }
  }

  const total = Math.round(cart.reduce((sum, item) => sum + (item.total || 0), 0) * 100) / 100

  return {
    cart,
    addToCart,
    addWeightToCart,
    updateCartItemQuantity,
    updateCartItemWeight,
    removeFromCart,
    clearCart,
    total,
    itemCount: cart.length
  }
}
