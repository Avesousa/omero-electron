import { useState, useEffect, useRef } from 'react'
import type { Product } from '../types'
import { apiFetch } from '@/lib/apiClient'

const CACHE_KEY = 'pos_products_cache'
const FETCH_TIMEOUT = 2000          // 2s → si tarda más, falla y reintenta
const RETRY_DELAY = 30 * 1000      // 30s entre reintentos async

interface ProductCache {
  products: Product[]
  timestamp: number
}

const transformProduct = (p: any): Product => ({
  id: p.id,
  name: p.name,
  code: p.code,
  barcode: p.barcode,
  price: p.sellingPrice,
  stock: p.stock,
  costPrice: p.costPrice,
  category: p.category
})

const loadCache = (): ProductCache | null => {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

const saveCache = (products: Product[]) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ products, timestamp: Date.now() }))
  } catch {}
}

export const useProducts = () => {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const revalidating = useRef(false)
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (retryTimer.current) clearTimeout(retryTimer.current)
    }
  }, [])

  useEffect(() => {
    const cached = loadCache()

    if (cached?.products.length) {
      // Sirve desde cache inmediatamente — sin loading
      setProducts(cached.products)
      setLoading(false)

      // Siempre revalida en background para reflejar cambios de stock/precio
      revalidateInBackground()
    } else {
      // Sin cache: fetch bloqueante normal
      fetchProducts()
    }
  }, [])

  const fetchProducts = async () => {
    try {
      setLoading(true)
      const result = await apiFetch<any[]>('/api/products')
      if (result.success) {
        const transformed = result.data.map(transformProduct)
        setProducts(transformed)
        saveCache(transformed)
      } else {
        setError(result.error || 'Error al cargar productos')
      }
    } catch (err) {
      setError('Error de conexión')
      console.error('Error fetching products:', err)
    } finally {
      setLoading(false)
    }
  }

  // Revalida en background: timeout corto, si falla agenda retry async
  const revalidateInBackground = async () => {
    if (revalidating.current) return
    revalidating.current = true

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT)

    try {
      const result = await apiFetch<any[]>('/api/products', { signal: controller.signal })
      if (result.success) {
        const transformed = result.data.map(transformProduct)
        setProducts(transformed)
        saveCache(transformed)
        return // éxito → no hay retry pendiente
      }
    } catch {
      // Timeout o error de red → cache actual sigue vigente
    } finally {
      clearTimeout(timeout)
      revalidating.current = false
    }

    // Si llegamos acá falló → agenda reintento async sin bloquear nada
    if (retryTimer.current) clearTimeout(retryTimer.current)
    retryTimer.current = setTimeout(() => revalidateInBackground(), RETRY_DELAY)
  }

  const findProductByCode = (code: string): Product | null => {
    const byCode = products.find(p => p.code === code)
    if (byCode) return byCode
    const byBarcode = products.find(p => p.barcode && p.barcode.toString() === code)
    if (byBarcode) return byBarcode
    return products.find(p => p.id === code) ?? null
  }

  const searchProductByCodePrefix = (prefix: string): Product[] => {
    if (prefix.length < 3) return []
    return products.filter(p =>
      p.code.startsWith(prefix) ||
      (p.barcode && p.barcode.toString().startsWith(prefix)) ||
      p.id.startsWith(prefix)
    )
  }

  const getProductByCode = async (code: string): Promise<Product | null> => {
    const local = findProductByCode(code)
    if (local) return local

    // Fallback a API si no está en cache
    try {
      const result = await apiFetch<any>(`/api/products/${code}`)
      if (result.success) return transformProduct(result.data)
    } catch {}
    return null
  }

  // Recarga silenciosa completa — para usar antes de mostrar error al usuario.
  // Devuelve el array fresco para que el llamador pueda reintentar sin esperar re-render.
  const refreshProducts = async (): Promise<Product[]> => {
    try {
      const result = await apiFetch<any[]>('/api/products')
      if (result.success) {
        const transformed = result.data.map(transformProduct)
        setProducts(transformed)
        saveCache(transformed)
        return transformed
      }
    } catch {}
    return products
  }

  return {
    products,
    loading,
    error,
    fetchProducts,
    refreshProducts,
    getProductByCode,
    findProductByCode,
    searchProductByCodePrefix
  }
}
