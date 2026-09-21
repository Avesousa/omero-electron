'use client'

import { useState, useEffect, useRef } from 'react'
import type { InputMode, DeleteModalState, Product } from './types'
import { STRINGS, MOCK_PRODUCTS } from './constants'

// Components
import {
  InputDisplay,
  CartList,
  CartSummary,
  PaymentModal,
  DeleteModal,
  ExpenseModal,
  ProductsModal,
  DailySummaryModal,
  MpTransactionsModal,
  FreePriceModal,
  Notification,
  KeyboardGuide
} from './components'

// Hooks
// Keyboard hook selection:
//   - Web (default): useKeyboard from './hooks' re-exports useKeyboard.web.ts.
//     Applies an allowedKeys filter so alphabetic input is silently dropped in a
//     standard browser context where any key can reach the renderer.
//   - Electron: useKeyboard.electron.ts (same interface, no allowedKeys filter).
//     Electron's main process (omero-electron/main/keyboard.ts) already restricts
//     input via `before-input-event` at the OS level before it reaches the renderer,
//     so double-filtering here is unnecessary and would break shortcode keys.
//     To activate the Electron hook, set NEXT_PUBLIC_ELECTRON=true at build time and
//     update the re-export in hooks/index.ts to point to useKeyboard.electron.ts, or
//     detect window.electronAPI?.isElectron at runtime and swap implementations.
import { useNotifications, useCart, usePayment, useKeyboard, useExpenses, useMercadoPagoEvents, useMercadoPagoPolling } from './hooks'
import { useProducts, useSales, useOfflineQueue } from './hooks'
import { OmeroLogo } from '../components/OmeroLogo'
import { ThemeToggle } from '../components/ThemeToggle'
import { Modal } from '@/app/components/ui/Modal'

export default function POSPage() {
  // State
  const [mode, setMode] = useState<InputMode>('code')
  const [currentInput, setCurrentInput] = useState('')
  const autoAddedRef = useRef(false)
  const [cashReceived, setCashReceived] = useState('')
  const [deleteModal, setDeleteModal] = useState<DeleteModalState>({
    isOpen: false,
    deleteModalInput: '',
    showClearConfirmation: false
  })
  const [currentProductCode, setCurrentProductCode] = useState('')
  const [currentProduct, setCurrentProduct] = useState<Product | null>(null)
  const [isMultiplyMode, setIsMultiplyMode] = useState(false)
  const [currentCartQuantity, setCurrentCartQuantity] = useState(0)
  const [previousCartQuantity, setPreviousCartQuantity] = useState(0)
  const [productsModal, setProductsModal] = useState({
    isOpen: false,
    searchQuery: ''
  })
  const [showDailySummary, setShowDailySummary] = useState(false)
  const [showMpTransactions, setShowMpTransactions] = useState(false)
  const mpListRef = useRef<HTMLDivElement>(null)
  const [showFreePrice, setShowFreePrice] = useState(false)
  const [cacheRefreshing, setCacheRefreshing] = useState(false)
  const [cacheRefreshed, setCacheRefreshed] = useState(false)

  // Custom hooks
  const { notification, showNotification } = useNotifications()
  const {
    isConnected: mpConnected,
    sseConnected,
    mpConnected: isMpApiConnected,
    lastPayment,
    lastPaymentTime,
    clearLastPayment
  } = useMercadoPagoEvents({ showNotification })
  const { triggerPollingIfNeeded } = useMercadoPagoPolling({
    sseConnected,
    mpConnected: isMpApiConnected,
    lastPaymentTime,
  })
  const { cart, addToCart, updateCartItemQuantity, removeFromCart, clearCart, total } = useCart(showNotification)
  const { 
    paymentState, 
    openPaymentModal, 
    closePaymentModal, 
    selectPaymentMethod, 
    updatePaymentInput, 
    processPayment, 
    confirmChange,
    resetPayment 
  } = usePayment(showNotification)
  const {
    products,
    loading: productsLoading,
    getProductByCode,
    findProductByCode,
    refreshProducts,
    searchProductByCodePrefix,
    fetchProducts
  } = useProducts()
  const { flushQueue, pendingCount, refreshCount } = useOfflineQueue()
  const { createSale, isProcessing } = useSales(showNotification, flushQueue, refreshCount)
  const {
    expenseState,
    openExpenseModal,
    closeExpenseModal,
    updateAmount,
    createExpense
  } = useExpenses(showNotification)

  // Product handling
  const handleAddProduct = async (code?: string) => {
    if (autoAddedRef.current) {
      autoAddedRef.current = false
      return
    }
    const codeToSearch = code || currentInput
    if (codeToSearch === '000') {
      setShowFreePrice(true)
      setCurrentInput('')
      return
    }
    if (!codeToSearch) return

    console.log('🔍 [CÓDIGO DE BARRA] Iniciando búsqueda de producto...')
    console.log('📝 [CÓDIGO DE BARRA] Código ingresado:', codeToSearch)
    console.log('📊 [CÓDIGO DE BARRA] Estado actual:', {
      mode,
      currentInput,
      cartLength: cart.length,
      timestamp: new Date().toISOString()
    })

    try {
      // Buscar producto por código, barcode o ID en memoria local
      console.log('🔎 [BÚSQUEDA] Buscando en productos locales...')
      console.log('📦 [BÚSQUEDA] Total de productos en memoria:', products.length)
      console.log('🔍 [BÚSQUEDA] Buscando por código/barcode/ID:', codeToSearch)
      
      const product = findProductByCode(codeToSearch)
      
      if (!product) {
        console.log('❌ [BÚSQUEDA] Producto NO encontrado con:', codeToSearch)
        // Intentar buscar en la API como fallback
        console.log('🌐 [BÚSQUEDA] Intentando búsqueda en API...')
        const apiProduct = await getProductByCode(codeToSearch)
        if (apiProduct) {
          console.log('✅ [BÚSQUEDA] Producto encontrado en API:', apiProduct.name)
          if (apiProduct.stock <= 0) {
            showNotification('Producto sin stock', 'error')
            setCurrentInput('')
            return
          }
          addToCart(apiProduct, 1)
          setCurrentInput('')
          return
        }
        // Último recurso: recargar lista completa y reintentar
        console.log('🔄 [BÚSQUEDA] Recargando lista completa...')
        const fresh = await refreshProducts()
        const freshProduct = fresh.find(p =>
          p.code === codeToSearch ||
          p.barcode?.toString() === codeToSearch ||
          p.id?.toString() === codeToSearch
        )
        if (freshProduct && freshProduct.stock > 0) {
          addToCart(freshProduct, 1)
        } else if (freshProduct) {
          showNotification('Producto sin stock', 'error')
        } else {
          showNotification('Producto no encontrado', 'error')
        }
        setCurrentInput('')
        return
      }

      console.log('✅ [CÓDIGO DE BARRA] Producto encontrado:', {
        id: product.id,
        name: product.name,
        code: product.code,
        price: product.price,
        stock: product.stock,
        barcode: product.barcode
      })

      if (product.stock <= 0) {
        console.log('⚠️ [BÚSQUEDA] Sin stock en cache, verificando online...')
        const fresh = await refreshProducts()
        const freshProduct = fresh.find(p =>
          p.code === codeToSearch ||
          p.barcode?.toString() === codeToSearch ||
          p.id?.toString() === codeToSearch
        )
        if (freshProduct && freshProduct.stock > 0) {
          addToCart(freshProduct, 1)
          setCurrentInput('')
          return
        }
        showNotification('Producto sin stock', 'error')
        setCurrentInput('')
        return
      }

      console.log('🛒 [BÚSQUEDA] Agregando producto al carrito...')
      console.log('📊 [BÚSQUEDA] Estado del carrito antes:', {
        itemsCount: cart.length,
        total: total
      })

      // Agregar directamente con cantidad 1
      addToCart(product, 1)
      
      console.log('✅ [CÓDIGO DE BARRA] Producto agregado exitosamente')
      console.log('📊 [CÓDIGO DE BARRA] Estado del carrito después:', {
        itemsCount: cart.length + 1,
        newTotal: total + product.price
      })
      
      setCurrentInput('')
      console.log('🧹 [CÓDIGO DE BARRA] Input limpiado')
    } catch (error) {
      console.error('❌ [CÓDIGO DE BARRA] Error al agregar producto:', error)
      console.error('📋 [CÓDIGO DE BARRA] Stack trace:', error instanceof Error ? error.stack : 'N/A')
      showNotification('Error al agregar producto', 'error')
      setCurrentInput('')
    }
  }

  // Efecto para búsqueda automática cuando se ingresan 4+ dígitos (códigos de barra)
  useEffect(() => {
    if (currentInput === '000') {
      setShowFreePrice(true)
      setCurrentInput('')
      return
    }
    if (mode === 'code' && currentInput.length >= 4) {
      // Auto-búsqueda solo para códigos de barra (4+ dígitos)
      // Códigos cortos (< 4 dígitos) requieren + o Enter para validar
      const matches = products.filter(p =>
        p.barcode?.toString() === currentInput || p.id?.toString() === currentInput
      )
      if (matches.length === 1) {
        const product = matches[0]
        if (product.stock > 0) {
          console.log('🛒 [BÚSQUEDA AUTO] Agregando automáticamente al carrito...')
          autoAddedRef.current = true
          addToCart(product, 1)
          setCurrentInput('')
        } else {
          // Verificar online antes de mostrar error
          const inputSnapshot = currentInput
          setCurrentInput('')
          refreshProducts().then(fresh => {
            const freshProduct = fresh.find(p =>
              p.barcode?.toString() === inputSnapshot ||
              p.id?.toString() === inputSnapshot
            )
            if (freshProduct && freshProduct.stock > 0) {
              addToCart(freshProduct, 1)
            } else {
              showNotification('Producto sin stock', 'error')
            }
          })
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentInput, mode, products])

  const handleConfirmFreePrice = (price: number) => {
    const freeProduct = {
      id: '0',
      code: `000-${Date.now()}`,
      name: 'Precio libre',
      price,
      sellingPrice: price,
      costPrice: price,
      stock: 9999,
      barcode: null,
      categoryId: 'sistema',
      category: null,
      saleFormat: 'UNIT' as const,
      unitsPerBox: null,
      profitMargin: 0,
      rounding: 0,
      pricingMode: 'MANUAL',
      pendingProcessing: false,
    }
    addToCart(freeProduct as any, 1)
    setShowFreePrice(false)
    setCurrentInput('')
  }

  const handleConfirmQuantity = async () => {
    const quantity = parseInt(currentInput) || 1
    
    if (!currentProduct) {
      showNotification('Producto no encontrado', 'error')
      setMode('code')
      setCurrentInput('')
      setIsMultiplyMode(false)
      setCurrentCartQuantity(0)
      setPreviousCartQuantity(0)
      return
    }

    try {
      if (isMultiplyMode) {
        // Modo multiplicar (*)
        let newQuantity: number
        
        if (currentCartQuantity === 1) {
          // Caso 1: Producto recién agregado (tiene 1 unidad) - REEMPLAZAR cantidad
          newQuantity = quantity
        } else {
          // Caso 2: Producto que ya tenía cantidad previa - SUMAR a la cantidad previa (antes del último agregado)
          // La cantidad previa es currentCartQuantity - 1 (porque se agregó 1 unidad por defecto)
          newQuantity = previousCartQuantity + quantity
        }
        
        if (currentProduct.stock < newQuantity) {
          showNotification(`Stock insuficiente. Disponible: ${currentProduct.stock}`, 'error')
          return
        }
        updateCartItemQuantity(currentProduct.code, newQuantity)
      } else {
        // Modo normal (agregar producto)
        if (currentProduct.stock < quantity) {
          showNotification(`Stock insuficiente. Disponible: ${currentProduct.stock}`, 'error')
          return
        }
        addToCart(currentProduct, quantity)
      }

      setMode('code')
      setCurrentInput('')
      setCurrentProductCode('')
      setCurrentProduct(null)
      setIsMultiplyMode(false)
      setCurrentCartQuantity(0)
      setPreviousCartQuantity(0)
      localStorage.removeItem('currentProductCode')
    } catch (error) {
      showNotification('Error al agregar producto', 'error')
    }
  }

  const handleFinalizeSale = () => {
    if (cart.length === 0) {
      showNotification(STRINGS.NOTIF_NO_PRODUCTS, 'error')
      return
    }

    openPaymentModal(total)
  }

  const handleCompleteSale = async (
    cashAmount: number,
    mpAmount: number,
    change: number
  ): Promise<boolean> => {
    try {
      const result = await createSale(cart, cashAmount, mpAmount, change)

      if (result.success) {
        showNotification('Venta procesada exitosamente', 'success')
        // Recargar productos después de la venta
        await fetchProducts()
        return true
      } else if (!result.success && result.queuing) {
        // Sale will be retried / queued offline — treat as success so UI clears
        // The offline notification is shown by useSales after queue write completes
        return true
      } else {
        showNotification(result.error || 'Error al procesar la venta', 'error')
        return false
      }
    } catch (error) {
      showNotification('Error al procesar la venta', 'error')
      return false
    }
  }

  // Delete modal handlers
  const handleDeleteProduct = (index: number) => {
    const actualIndex = cart.length - 1 - index
    removeFromCart(actualIndex)

    if (cart.length <= 1) {
      setDeleteModal(prev => ({ ...prev, isOpen: false }))
    }
  }

  const handleOpenDeleteModal = () => {
    if (cart.length > 0) {
      setDeleteModal(prev => ({
        ...prev,
        isOpen: true,
        deleteModalInput: '',
        showClearConfirmation: false
      }))
    } else {
      showNotification('No hay productos para eliminar', 'info')
    }
  }

  const handleCloseDeleteModal = () => {
    setDeleteModal(prev => ({ 
      ...prev, 
      isOpen: false,
      deleteModalInput: '',
      showClearConfirmation: false
    }))
  }

  // Products modal handlers
  const handleOpenProductsModal = () => {
    setProductsModal({
      isOpen: true,
      searchQuery: ''
    })
  }

  const handleCloseProductsModal = () => {
    setProductsModal({
      isOpen: false,
      searchQuery: ''
    })
  }

  // Payment handlers
  const handlePaymentComplete = async (
    saleCompleted: boolean, 
    paymentValues?: { cashAmount: number, mpAmount: number, change: number }
  ) => {
    if (saleCompleted) {
      // Usar los valores pasados directamente si están disponibles, 
      // de lo contrario usar los valores del estado (para casos legacy o confirmChange)
      const cashAmount = paymentValues?.cashAmount ?? paymentState.cashAmount
      const mpAmount = paymentValues?.mpAmount ?? paymentState.mpAmount
      const change = paymentValues?.change ?? paymentState.change
      
      // Guardar la venta en la base de datos
      const result = await handleCompleteSale(cashAmount, mpAmount, change)

      // Solo limpiar y cerrar si la venta se guardó exitosamente
      if (result) {
        clearCart()
        setMode('code')
        setCurrentInput('')
        setCashReceived('')
        closePaymentModal()
        resetPayment()
      }
    }
  }

  // Inicia el polling de MP en el momento que el cajero confirma el pago con MP,
  // antes de que la venta se guarde — el backend se encarga de encontrar la transferencia.
  const handleConfirmPayment = () => {
    if (paymentState.paymentMethod === 'mercadopago') {
      triggerPollingIfNeeded(parseFloat(paymentState.paymentInput) || 1)
    }
    processPayment(handlePaymentComplete)
  }

  // Keyboard handling
  const handleKeyPress = (key: string) => {
    if (showMpTransactions) {
      if (key === 'Escape' || key === 'Tab') setShowMpTransactions(false)
      else if (key === 'ArrowUp' || key === '8') mpListRef.current?.scrollBy({ top: -120 })
      else if (key === 'ArrowDown' || key === '2') mpListRef.current?.scrollBy({ top: 120 })
      return
    }
    if (key === 'Tab') {
      setShowDailySummary(prev => !prev)
      return
    }
    if (showDailySummary) {
      if (key === 'Escape') setShowDailySummary(false)
      return
    }
    if (showFreePrice) {
      if (key === 'Escape') {
        setShowFreePrice(false)
        setCurrentInput('')
        return
      }
      if (key === 'Enter') {
        const price = parseFloat(currentInput)
        if (price > 0) {
          handleConfirmFreePrice(price)
        }
        return
      }
      if (/^\d$/.test(key)) {
        setCurrentInput(prev => prev + key)
        return
      }
      if (key === 'Backspace') {
        setCurrentInput(prev => prev.slice(0, -1))
        return
      }
      return
    }
    console.log('🔑 Key pressed:', key)
    console.log('📊 Payment state:', {
      showPaymentModal: paymentState.showPaymentModal,
      showingChange: paymentState.showingChange,
      paymentMethod: paymentState.paymentMethod,
      isProcessingPayment: paymentState.isProcessingPayment
    })
    
    // Handle products modal
    if (productsModal.isOpen) {
      if (key === 'Escape') {
        handleCloseProductsModal()
        return
      } else if (/^\d$/.test(key)) {
        setProductsModal(prev => ({
          ...prev,
          searchQuery: prev.searchQuery + key
        }))
        return
      } else if (key === 'Backspace') {
        setProductsModal(prev => ({
          ...prev,
          searchQuery: prev.searchQuery.slice(0, -1)
        }))
        return
      }
      return
    }

    // Handle expense modal
    if (expenseState.showExpenseModal) {
      if (key === 'Enter') {
        createExpense(() => {})
        return
      } else if (key === 'Escape') {
        closeExpenseModal()
        return
      } else if (/^\d$/.test(key) || key === '.') {
        updateAmount(expenseState.amount + key)
        return
      } else if (key === 'Backspace') {
        updateAmount(expenseState.amount.slice(0, -1))
        return
      }
      return
    }

    // Handle delete modal
    if (deleteModal.isOpen) {
      if (deleteModal.showClearConfirmation) {
        if (key === 'Enter') {
          clearCart()
          handleCloseDeleteModal()
        } else if (key === 'Escape') {
          setDeleteModal(prev => ({ ...prev, showClearConfirmation: false }))
        }
        return
      }

      if (key === '-') {
        if (deleteModal.deleteModalInput.trim()) {
          const displayIndex = parseInt(deleteModal.deleteModalInput.trim())
          if (displayIndex >= 1 && displayIndex <= cart.length) {
            handleDeleteProduct(displayIndex - 1)
            setDeleteModal(prev => ({ ...prev, deleteModalInput: '' }))
          } else {
            showNotification(STRINGS.NOTIF_INVALID_INDEX, 'error')
            setDeleteModal(prev => ({ ...prev, deleteModalInput: '' }))
          }
        } else {
          setDeleteModal(prev => ({ ...prev, showClearConfirmation: true }))
        }
        return
      } else if (key === 'Escape') {
        handleCloseDeleteModal()
        return
      } else if (/^\d$/.test(key)) {
        setDeleteModal(prev => ({ 
          ...prev, 
          deleteModalInput: prev.deleteModalInput + key 
        }))
        return
      } else if (key === 'Backspace') {
        setDeleteModal(prev => ({ 
          ...prev, 
          deleteModalInput: prev.deleteModalInput.slice(0, -1) 
        }))
        return
      }
      return
    }

    // Handle change confirmation screen (debe ir primero antes de otras condiciones del modal)
    if (paymentState.showPaymentModal && paymentState.showingChange) {
      console.log('🎯 In change confirmation screen!')
      if (key === 'Enter') {
        console.log('✅ Enter pressed in change screen, calling confirmChange')
        confirmChange(handlePaymentComplete)
        return
      }
      return
    }

    // Handle payment modal
    if (paymentState.showPaymentModal && !paymentState.paymentMethod) {
      if (key === '1') {
        selectPaymentMethod('mercadopago')
        return
      } else if (key === '2') {
        selectPaymentMethod('cash')
        return
      } else if (key === 'Escape') {
        closePaymentModal()
        return
      }
      return
    }

    if (paymentState.showPaymentModal && paymentState.paymentMethod && !paymentState.isProcessingPayment && !paymentState.showingChange) {
      if (key === 'Enter') {
        handleConfirmPayment()
        return
      } else if (key === 'Escape') {
        selectPaymentMethod(null)
        return
      } else if (/^\d$/.test(key) || key === '.') {
        updatePaymentInput(paymentState.paymentInput + key)
        return
      } else if (key === 'Backspace') {
        updatePaymentInput(paymentState.paymentInput.slice(0, -1))
        return
      }
      return
    }

    // Handle main input
    if (key === '+') {
      if (mode === 'code') {
        handleAddProduct()
      } else if (mode === 'quantity') {
        handleConfirmQuantity()
      }
    } else if (key === 'Enter') {
      if (currentInput.trim()) {
        if (mode === 'code') {
          // Códigos cortos (< 4 dígitos) requieren + para agregar; Enter no actúa
          if (currentInput.length >= 4) {
            handleAddProduct()
          }
        } else if (mode === 'quantity') {
          handleConfirmQuantity()
        }
      } else {
        // Si no hay datos, abrir modal de pago
        handleFinalizeSale()
      }
    } else if (key === 'Escape') {
      if (mode === 'quantity') {
        setMode('code')
        setCurrentInput('')
        setCurrentProductCode('')
        setCurrentProduct(null)
        setIsMultiplyMode(false)
        setCurrentCartQuantity(0)
        setPreviousCartQuantity(0)
        localStorage.removeItem('currentProductCode')
        showNotification(STRINGS.NOTIF_BACK_TO_CODE, 'info')
      }
    } else if (key === '-') {
      handleOpenDeleteModal()
    } else if (key === 't' || key === 'T') {
      setShowMpTransactions(true)
    } else if (key === '/') {
      handleOpenProductsModal()
    } else if (key === '*') {
      // Multiplicar/agregar cantidad del último producto agregado
      if (cart.length > 0) {
        const lastProductCode = cart[cart.length - 1].code
        const lastProduct = findProductByCode(lastProductCode)
        const lastCartItem = cart[cart.length - 1]
        
        if (lastProduct) {
          setCurrentProductCode(lastProductCode)
          setCurrentProduct(lastProduct)
          setCurrentCartQuantity(lastCartItem.quantity)
          
          // Calcular cantidad previa (restar 1 porque se agregó 1 unidad por defecto)
          // Si la cantidad actual es 1, la cantidad previa es 0 (producto recién agregado)
          const prevQty = lastCartItem.quantity === 1 ? 0 : lastCartItem.quantity - 1
          setPreviousCartQuantity(prevQty)
          
          setIsMultiplyMode(true)
          setMode('quantity')
          setCurrentInput('')
          
          if (lastCartItem.quantity === 1) {
            showNotification(`Modificar cantidad de: ${lastProduct.name}`, 'info')
          } else {
            showNotification(`Agregar cantidad a: ${lastProduct.name} (${prevQty} previas + 1 agregada)`, 'info')
          }
        }
      } else {
        showNotification('No hay productos en el carrito', 'error')
      }
    } else if (key === '.') {
      // Abrir modal de gastos en modo código, permitir decimales en modo cantidad
      if (mode === 'code') {
        openExpenseModal()
      } else if (mode === 'quantity') {
        setCurrentInput(prev => prev + key)
      }
    } else if (key === 'Backspace') {
      if (mode !== 'payment') {
        setCurrentInput(prev => prev.slice(0, -1))
      }
    } else if (/^\d$/.test(key)) {
      if (mode === 'quantity') {
        const newInput = currentInput + key
        console.log('🔢 [INPUT] Modo cantidad - dígito ingresado:', key)
        console.log('📝 [INPUT] Nuevo valor:', newInput)
        setCurrentInput(newInput)
      } else if (mode !== 'payment') {
        const newInput = currentInput + key
        console.log('🔢 [INPUT] Modo código - dígito ingresado:', key)
        console.log('📝 [INPUT] Código actual:', newInput)
        console.log('📊 [INPUT] Longitud del código:', newInput.length)
        setCurrentInput(newInput)
      }
    }
  }

  useKeyboard(handleKeyPress)

  if (productsLoading) {
    return (
      <div className="pos-layout min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4">⏳</div>
          <div className="text-xl">Cargando productos...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="pos-layout h-screen bg-black text-white flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-black border-b-4 flex-shrink-0 px-6 py-3" style={{ borderColor: '#FF6B00' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <OmeroLogo width={100} height={22} />
            <span className="text-gray-500 text-lg select-none">|</span>
            <span className="text-lg font-semibold tracking-wide" style={{ color: '#FF6B00' }}>
              {STRINGS.MAIN_TITLE}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {pendingCount > 0 && (
              <span className="bg-amber-500 text-black text-sm font-bold px-3 py-1 rounded-full">
                {pendingCount} pendiente{pendingCount !== 1 ? 's' : ''} sin sync
              </span>
            )}
            <button
              onClick={async () => {
                if (cacheRefreshing) return
                setCacheRefreshing(true)
                setCacheRefreshed(false)
                await refreshProducts()
                setCacheRefreshing(false)
                setCacheRefreshed(true)
                setTimeout(() => setCacheRefreshed(false), 2000)
              }}
              disabled={cacheRefreshing}
              title="Actualizar productos"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={cacheRefreshed
                ? { borderColor: '#22c55e', color: '#22c55e', background: 'rgba(34,197,94,0.1)' }
                : { borderColor: '#FF6B00', color: '#FF6B00', background: 'transparent' }
              }
            >
              <span className={cacheRefreshing ? 'animate-spin inline-block' : 'inline-block'}>
                {cacheRefreshed ? '✓' : '↻'}
              </span>
              <span>{cacheRefreshing ? 'Actualizando...' : cacheRefreshed ? 'Actualizado' : 'Actualizar'}</span>
            </button>
            <ThemeToggle />
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 p-6 min-h-0 overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 w-full max-w-7xl mx-auto h-full">
          {/* Input Section */}
          <div className="lg:col-span-1 flex flex-col">
            <InputDisplay 
              mode={mode}
              currentInput={currentInput}
              cashReceived={cashReceived}
              currentProduct={currentProduct}
            />
          </div>

          {/* Cart Section */}
          <div className="lg:col-span-1 flex flex-col min-h-0">
            <div className="bg-black border-4 p-4 flex flex-col h-full" style={{ borderColor: '#FF6B00' }}>
              {/* Cart Header - Fixed at top */}
              <div className="flex-shrink-0 mb-4">
                <h2 className="text-xl font-bold text-center" style={{ color: '#FF6B00' }}>
                  {STRINGS.CART_TITLE}
                </h2>
              </div>

              {/* Cart Items - Scrollable area */}
              <div className="flex-1 overflow-y-auto min-h-0 mb-4">
                <CartList cart={cart} />
              </div>

              {/* Cart Summary - Fixed at bottom */}
              <div className="border-t-4 pt-3 bg-black flex-shrink-0" style={{ borderColor: '#FF6B00' }}>
                <CartSummary 
                  total={total}
                  itemCount={cart.length}
                  onFinalizeSale={handleFinalizeSale}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Keyboard Guide - Fixed at bottom */}
      <div className="bg-black border-t-2 border-gray-700 flex-shrink-0">
        <div className="max-w-7xl mx-auto p-4">
          <KeyboardGuide variant="main" onKeyPress={handleKeyPress} />
        </div>
      </div>

      {/* Modals */}
      <PaymentModal
        show={paymentState.showPaymentModal}
        paymentState={paymentState}
        total={total}
        mpConnected={mpConnected}
        onSelectMethod={selectPaymentMethod}
        onConfirmPayment={
          paymentState.showingChange
            ? () => confirmChange(handlePaymentComplete)
            : handleConfirmPayment
        }
        onBack={() => selectPaymentMethod(null)}
        onCancel={closePaymentModal}
        onKeyPress={handleKeyPress}
      />

      <DeleteModal
        show={deleteModal.isOpen}
        cart={cart}
        deleteInput={deleteModal.deleteModalInput}
        showClearConfirmation={deleteModal.showClearConfirmation}
        onClose={handleCloseDeleteModal}
        onClearAll={() => {
          clearCart()
          handleCloseDeleteModal()
        }}
        onCancelClear={() => setDeleteModal(prev => ({ ...prev, showClearConfirmation: false }))}
        onKeyPress={handleKeyPress}
      />

      <ExpenseModal
        show={expenseState.showExpenseModal}
        amount={expenseState.amount}
        isProcessing={expenseState.isProcessing}
        onAmountChange={updateAmount}
        onConfirm={() => createExpense(() => {})}
        onCancel={closeExpenseModal}
        onKeyPress={handleKeyPress}
      />

      <ProductsModal
        show={productsModal.isOpen}
        products={products}
        searchQuery={productsModal.searchQuery}
        onClose={handleCloseProductsModal}
        onKeyPress={handleKeyPress}
      />

      <DailySummaryModal
        show={showDailySummary}
        onClose={() => setShowDailySummary(false)}
      />

      <MpTransactionsModal show={showMpTransactions} listRef={mpListRef} />

      <FreePriceModal
        show={showFreePrice}
        currentInput={currentInput}
        onConfirm={handleConfirmFreePrice}
        onClose={() => { setShowFreePrice(false); setCurrentInput('') }}
      />

      {/* Persistent MP payment banner */}
      {lastPayment && (
        <div className="fixed bottom-6 right-6 z-[100] bg-green-700 border-4 border-green-400 text-white px-6 py-4 rounded-xl shadow-2xl max-w-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-green-300 mb-1">Pago recibido</div>
              <div className="text-2xl font-bold">${lastPayment.amount.toLocaleString()}</div>
              <div className="text-sm text-green-200 mt-1">{lastPayment.method}</div>
            </div>
            <button
              onClick={clearLastPayment}
              className="text-green-300 hover:text-white text-xl font-bold leading-none mt-1"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Notification */}
      <Notification notification={notification} />

      {/* Loading overlay for processing sales */}
      <Modal isOpen={isProcessing} onClose={() => {}} hideClose closeOnEsc={false} tone="dark" size="xs" accent="primary">
        <div className="text-center py-4">
          <div className="text-4xl mb-4">⏳</div>
          <div className="text-xl text-blue-400">Procesando venta...</div>
        </div>
      </Modal>
    </div>
  )
} 