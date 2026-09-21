'use client'

import { useState } from 'react'
import type { Product } from '../../types'
import { KeyboardGuide } from '../keyboard/KeyboardGuide'
import { Modal } from '@/app/components/ui/Modal'

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
      tone="dark"
      accent="brand"
      size="full"
      title="Productos disponibles"
      subtitle={`Total: ${filteredProducts.length} productos`}
      flush
      footer={
        <div className="w-full text-center">
          <KeyboardGuide variant="products" onKeyPress={onKeyPress} />
          <div className="text-sm text-gray-400 mt-3">Presione ⇧ para cerrar</div>
        </div>
      }
    >
      {/* Search Input */}
      <div className="p-4 border-b border-gray-700 flex items-center gap-3 sticky top-0 z-10" style={{ background: 'var(--c-surface)' }}>
        <input
          type="text"
          value={internalSearch}
          onChange={e => setInternalSearch(e.target.value)}
          placeholder="Buscar por código, ID o nombre..."
          autoFocus
          className="o-control flex-1 font-mono"
        />
        {internalSearch && (
          <button onClick={() => setInternalSearch('')} className="text-gray-400 hover:text-white text-sm px-2" aria-label="Limpiar búsqueda">
            ✕
          </button>
        )}
        {!internalSearch && searchQuery && (
          <span className="text-purple-400 text-sm font-mono">{searchQuery}</span>
        )}
      </div>

      {/* Products Grid */}
      <div className="p-4">
          {filteredProducts.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-4xl mb-4">🔍</div>
              <div className="text-xl text-gray-400">
                No se encontraron productos
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {filteredProducts.map(product => (
                <div 
                  key={product.code} 
                  className="o-row p-4 text-center hover:!border-purple-500 transition-colors"
                >
                  <div className="text-2xl font-mono font-bold text-yellow-400 mb-2">
                    {product.code}
                  </div>
                  <div className="text-base text-white mb-2 truncate" title={product.name}>
                    {product.name}
                  </div>
                  <div className="text-lg text-green-400 font-bold mb-1">
                    ${(product.price || 0).toLocaleString()}
                  </div>
                  <div className={`text-xs font-semibold ${
                    product.stock > 10 
                      ? 'text-green-400' 
                      : product.stock > 0 
                        ? 'text-yellow-400' 
                        : 'text-red-400'
                  }`}>
                    Stock: {product.stock}
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>
    </Modal>
  )
}
