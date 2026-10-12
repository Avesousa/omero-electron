import type { Product } from '../../types'

const base: Product = {
  id: '1',
  code: '001',
  name: 'Coca 2L',
  price: 1000,
  costPrice: 600,
  stock: 20,
  saleFormat: 'UNIT',
}

export const unitProduct = (over: Partial<Product> = {}): Product => ({ ...base, ...over })

/** Por peso: precio, costo y stock por kg. */
export const weightProduct = (over: Partial<Product> = {}): Product => ({
  ...base, id: '2', code: '002', name: 'Queso cremoso', price: 8000, costPrice: 5000, stock: 12.5,
  saleFormat: 'GRAMS', ...over,
})

/** Por unidad y peso: se vende por kg o por pieza de 0,250 kg. */
export const mixedProduct = (over: Partial<Product> = {}): Product => ({
  ...base, id: '3', code: '003', name: 'Pan de campo', price: 4000, costPrice: 2000, stock: 5,
  saleFormat: 'MIXED', unitWeightKg: 0.25, unitPrice: 1200, ...over,
})
