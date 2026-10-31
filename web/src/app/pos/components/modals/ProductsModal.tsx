'use client'

import { useState } from 'react'
import type { Product } from '../../types'
import { KeyboardGuide } from '../keyboard/KeyboardGuide'
import { Modal } from '@/app/components/ui/Modal'
import { formatStock } from '@/lib/quantity'
import { isMixedProduct, needsWeightEntry, toQuantityProduct, unitPriceOfProduct } from '../../lib/cartLines'
import { formatMoney } from '@/lib/money'

interface ProductsModalProps {
  show: boolean
  products: Product[]
  searchQuery: string
  onClose: () => void
  onKeyPress?: (key: string) => void
}

const getSearchPriority = (product: Product, query: string): number => {
  const q = query.toLowerCase()
  if (product.code === query) return 0
  if (product.barcode && product.barcode.toString().startsWith(query)) return 1
  if (product.code.toLowerCase().includes(q)) return 2
  return 3 // name match
}

export const ProductsModal = ({
  show,
  products,
  searchQuery,
  onClose,
  onKeyPress
}: ProductsModalProps) => {
  const [internalSearch, setInternalSearch] = useState('')

  if (!show) return null

  const activeQuery = internalSearch || searchQuery

  const filteredProducts = activeQuery
    ? products
        .filter(p =>
          p.code.toLowerCase().includes(activeQuery.toLowerCase()) ||
          (p.barcode && p.barcode.toString().startsWith(activeQuery)) ||
          p.name.toLowerCase().includes(activeQuery.toLowerCase())
        )
        .sort((a, b) => getSearchPriority(a, activeQuery) - getSearchPriority(b, activeQuery))
    : products

  return (
    <Modal
      isOpen
      onClose={onClose}
      closeOnEsc={false}
     
      accent="brand"
      size="full"
      title="Productos disponibles"
      subtitle={`Total: ${filteredProducts.length} productos`}
      flush
      footer={
        <div className="w-full text-center">
          <KeyboardGuide variant="products" onKeyPress={onKeyPress} />
          <div className="text-sm pos-muted mt-3">Presioná <span className="pos-kbd is-light">⇧</span> para cerrar</div>
        </div>
      }
    >
      {/* Search Input */}
      <div className="px-5 py-4 border-b border-[var(--pos-line)] flex items-center gap-3 sticky top-0 z-10 bg-[var(--pos-card)]">
        <input
          type="text"
          value={internalSearch}
          onChange={e => setInternalSearch(e.target.value)}
          placeholder="Buscar por código, ID o nombre..."
          autoFocus
          className="flex-1 font-mono text-base rounded-2xl px-4 py-3 bg-[var(--pos-card-2)] text-[var(--pos-ink)] placeholder:text-[var(--pos-muted)] border border-[var(--pos-line)] outline-none transition focus:border-[var(--pos-primary-2)] focus:ring-4 focus:ring-[var(--pos-primary-soft)]"
        />
        {internalSearch && (
          <button onClick={() => setInternalSearch('')} className="pos-btn !px-3 !py-2 !text-sm" aria-label="Limpiar búsqueda">
            ✕
          </button>
        )}
        {!internalSearch && searchQuery && (
          <span className="pos-chip pos-primary font-mono">{searchQuery}</span>
        )}
      </div>

      {/* Products Grid */}
      <div className="p-5">
          {filteredProducts.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-4xl mb-4">🔍</div>
              <div className="text-xl pos-muted">
                No se encontraron productos
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {filteredProducts.map(product => (
                <div
                  key={product.code}
                  className="pos-card-2 !rounded-2xl p-4 text-center bg-[var(--pos-card)] hover:border-[var(--pos-primary-2)] transition-colors"
                >
                  <div className="text-2xl font-mono font-extrabold pos-primary mb-2">
                    {product.code}
                  </div>
                  <div className="text-base font-semibold pos-ink mb-3 truncate" title={product.name}>
                    {product.name}
                  </div>
                  <div className="text-2xl font-extrabold pos-num pos-ink mb-1">
                    {formatMoney(product.price || 0)}
                    {needsWeightEntry(product) && <span className="text-sm pos-muted font-semibold"> /kg</span>}
                  </div>
                  {isMixedProduct(product) && (
                    <div className="text-sm pos-success pos-num font-semibold mb-1">
                      {formatMoney(unitPriceOfProduct(product))} <span className="pos-muted">/u</span>
                    </div>
                  )}
                  <div className="mt-2">
                    <span className={`pos-chip !text-xs !py-1 ${
                      product.stock > 10
                        ? 'is-ok'
                        : product.stock > 0
                          ? 'is-warn'
                          : 'is-bad'
                    }`}>
                      Stock: {formatStock(toQuantityProduct(product), product.stock)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>
    </Modal>
  )
}
