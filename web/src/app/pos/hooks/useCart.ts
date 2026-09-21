import { useState, useMemo } from 'react'
import type { CartItem, Product } from '../types'
import { STRINGS } from '../constants/strings'
import { usePromotions } from './usePromotions'

export const useCart = (showNotification?: (message: string, type: 'success' | 'error' | 'info') => void) => {
  const [rawCart, setRawCart] = useState<CartItem[]>([])
  const { applyPromotions } = usePromotions()

  // Aplicar promociones usando useMemo para evitar re-renders innecesarios
  const cart = useMemo(() => {
    if (rawCart.length === 0) return []
    return applyPromotions(rawCart)
  }, [rawCart, applyPromotions])

  const addToCart = (product: Product, quantity: number) => {
    setRawCart(prev => {
      const existingItem = prev.find(item => item.code === product.code)
      
      let updatedCart: CartItem[]
      
      if (existingItem) {
        // Si existe, removerlo de su posición actual y agregarlo al final con nueva cantidad
        const newQuantity = existingItem.quantity + quantity
        const productPrice = product.price || 0
        const updatedItem: CartItem = {
          id: Date.now().toString(), // Nuevo ID para forzar re-render
          code: product.code,
          name: product.name,
          price: productPrice,
          quantity: newQuantity,
          total: productPrice * newQuantity,
          originalPrice: existingItem.originalPrice || productPrice
        }
        
        // Remover el item existente y agregar el actualizado al final
        updatedCart = [
          ...prev.filter(item => item.code !== product.code),
          updatedItem
        ]
      } else {
        // Si no existe, simplemente agregarlo al final
        const productPrice = product.price || 0
        const newItem: CartItem = {
          id: Date.now().toString(),
          code: product.code,
          name: product.name,
          price: productPrice,
          quantity,
          total: productPrice * quantity,
          originalPrice: productPrice
        }
        updatedCart = [...prev, newItem]
      }

      return updatedCart
    })
    
    if (showNotification) {
      showNotification(`${STRINGS.NOTIF_PRODUCT_ADDED} ${product.name}`, 'success')
    }
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

  const updateCartItemQuantity = (productCode: string, newQuantity: number) => {
    setRawCart(prev => {
      const existingItem = prev.find(item => item.code === productCode)
      
      if (existingItem) {
        const itemPrice = existingItem.price || 0
        const updatedItem: CartItem = {
          ...existingItem,
          id: Date.now().toString(), // Nuevo ID para forzar re-render
          quantity: newQuantity,
          total: itemPrice * newQuantity,
          originalPrice: existingItem.originalPrice || itemPrice
        }
        
        // Remover el item existente y agregar el actualizado al final
        return [
          ...prev.filter(item => item.code !== productCode),
          updatedItem
        ]
      }
      
      return prev
    })
  }

  const clearCart = () => {
    setRawCart([])
    if (showNotification) {
      showNotification(STRINGS.NOTIF_CART_CLEARED, 'success')
    }
  }

  const total = cart.reduce((sum, item) => sum + (item.total || 0), 0)

  return {
    cart,
    addToCart,
    updateCartItemQuantity,
    removeFromCart,
    clearCart,
    total,
    itemCount: cart.length
  }
} 