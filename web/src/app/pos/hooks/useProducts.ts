import { useState, useEffect, useRef } from 'react'
import type { Product } from '../types'
import { apiFetch, isTransportError, type ApiResult } from '@/lib/apiClient'
import { saleFormatOf, unitPriceOf } from '@/lib/quantity'
import { mergeStock, parseStockDelta, stockVersionOf } from '@/lib/stockDelta'

const CACHE_KEY = 'pos_products_cache'
const FETCH_TIMEOUT = 2000          // 2s → si tarda más, falla y reintenta
const RETRY_DELAY = 30 * 1000      // 30s entre reintentos async
/** Catálogo completo de respaldo (sin versión / delta vencido o inválido): como máximo una vez cada 5 min. */
export const FULL_FALLBACK_MIN_MS = 5 * 60_000
/** Reconciliación completa sin condicional: red de seguridad ante un cambio de stock perdido. */
export const FULL_RECONCILE_MS = 30 * 60_000

interface ProductCache {
  products: Product[]
  timestamp: number
}

export const transformProduct = (p: any): Product => {
  const saleFormat = saleFormatOf(p)
  return {
    id: p.id,
    name: p.name,
    code: p.code,
    barcode: p.barcode,
    price: p.sellingPrice,
    stock: p.stock,
    costPrice: p.costPrice,
    category: p.category,
    saleFormat,
    unitWeightKg: p.unitWeightKg ?? null,
    // Precio de una unidad de un producto por unidad y peso: lo resuelve el backend (`effectiveUnitPrice`); si la
    // respuesta viene de un backend anterior se calcula acá con la misma regla.
    unitPrice: saleFormat === 'MIXED' ? (p.effectiveUnitPrice ?? unitPriceOf(p)) : null,
    scalePlu: p.scalePlu ?? null,
  }
}

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
  // Versión de stock que el cliente ya tiene (de la última carga completa o del último delta). null = desconocida.
  const stockVersion = useRef<number | null>(null)
  const syncing = useRef(false)
  const syncAgain = useRef(false)
  const lastFallbackAt = useRef<number | null>(null)
  const unmounted = useRef(false)

  useEffect(() => {
    unmounted.current = false
    return () => {
      unmounted.current = true
      if (retryTimer.current) clearTimeout(retryTimer.current)
    }
  }, [])

  // Aplica una carga completa: estado, caché local y versión de stock (la carga completa es la verdad).
  const applyFull = (result: ApiResult<any[]> & { success: true }): Product[] => {
    const transformed = result.data.map(transformProduct)
    setProducts(transformed)
    saveCache(transformed)
    stockVersion.current = stockVersionOf(result.headers)
    return transformed
  }

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
        applyFull(result)
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
        applyFull(result)
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

  /** Producto con ese código de balanza (PLU de la etiqueta). */
  const findProductByScalePlu = (plu: number): Product | null =>
    products.find(p => p.scalePlu != null && Number(p.scalePlu) === plu) ?? null

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
      if (result.success) return applyFull(result)
    } catch {}
    return products
  }

  // Catálogo completo de respaldo, limitado a 1 cada 5 min. `force` salta el límite (reconciliación).
  const fullFallback = async (force = false) => {
    const now = Date.now()
    if (!force && lastFallbackAt.current !== null && now - lastFallbackAt.current < FULL_FALLBACK_MIN_MS) return
    lastFallbackAt.current = now
    try {
      // `reload`: sin If-None-Match del navegador (carga completa real, no un 304 reciclado).
      const result = await apiFetch<any[]>('/api/products', { cache: 'reload' })
      if (result.success && !unmounted.current) applyFull(result)
    } catch {}
  }

  const syncStockOnce = async () => {
    const since = stockVersion.current
    if (since === null) return fullFallback()
    let result: ApiResult<unknown>
    try {
      result = await apiFetch<unknown>(`/api/products/stock?since=${since}`)
    } catch {
      return // error de red: no se hace nada (respaldo de 30 s / próximo evento)
    }
    if (unmounted.current) return
    if (!result.success) {
      if (isTransportError(result.error)) return
      return fullFallback() // 410 (delta vencido), 404 (backend viejo) u otro error del contrato
    }
    const delta = parseStockDelta(result.data)
    if (!delta || delta.version < since) return fullFallback() // payload inválido o Redis reiniciado
    setProducts((prev) => {
      const merged = mergeStock(prev, delta.items)
      if (merged !== prev) saveCache(merged)
      return merged
    })
    // La versión solo avanza con lo que devolvió el delta y solo si es mayor.
    if (delta.version > since) stockVersion.current = delta.version
  }

  /**
   * Sincroniza el stock con `GET /api/products/stock?since=<versión local>`. El evento SSE `stock` solo la DISPARA
   * (nunca se aplica su payload). Una sola ejecución a la vez; si llegan más disparos mientras corre, se repite al terminar.
   */
  const syncStock = async (): Promise<void> => {
    if (syncing.current) {
      syncAgain.current = true
      return
    }
    syncing.current = true
    try {
      do {
        syncAgain.current = false
        await syncStockOnce()
      } while (syncAgain.current && !unmounted.current)
    } finally {
      syncing.current = false
    }
  }

  // Reconciliación completa sin condicional cada 30 min.
  const syncStockRef = useRef(fullFallback)
  syncStockRef.current = fullFallback
  useEffect(() => {
    const timer = setInterval(() => void syncStockRef.current(true), FULL_RECONCILE_MS)
    return () => clearInterval(timer)
  }, [])

  return {
    products,
    loading,
    error,
    fetchProducts,
    refreshProducts,
    syncStock,
    getProductByCode,
    findProductByCode,
    findProductByScalePlu,
    searchProductByCodePrefix
  }
}
