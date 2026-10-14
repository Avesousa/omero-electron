'use client'

import { Modal, ModalButton } from '@/app/components/ui/Modal'
import { formatKg, formatStock } from '@/lib/quantity'
import { isMixedProduct, toQuantityProduct, unitPriceOfProduct } from '../../lib/cartLines'
import { LARGE_WEIGHT_KG, weightEntrySubtotal, weightEntryValue, type WeightEntryState } from '../../lib/weightEntry'
import { formatMoney } from '@/lib/money'

interface Props {
  /** `null` = cerrado. */
  state: WeightEntryState | null
  /** Las teclas las maneja la página (el POS es todo teclado numérico); los botones mandan la misma tecla. */
  onKeyPress: (key: string) => void
}

const money = (n: number) => formatMoney(n)

/**
 * Panel de peso: se abre al ingresar un producto que se vende por peso. Hay que cargar los kg (o gramos), o las
 * unidades si el producto también se vende por unidad; sin eso no se puede agregar.
 */
export function WeightEntryModal({ state, onKeyPress }: Props) {
  if (!state) return null

  const { product, tab, gramsMode, input, largeWeightWarning, editLineId, currentWeightKg } = state
  const mixed = isMixedProduct(product)
  const value = weightEntryValue(state)
  const subtotal = weightEntrySubtotal(state)
  const unitLabel = tab === 'UNIT' ? 'u' : gramsMode ? 'g' : 'kg'
  const typed = input === '' ? '—' : input.replace('.', ',')

  return (
    <Modal
      isOpen
      onClose={() => onKeyPress('Escape')}
      closeOnEsc={false}
     
      accent="info"
      size="md"
      title={editLineId ? `Corregir peso · ${product.name}` : product.name}
      subtitle={
        <>
          Código {product.code} · {money(product.price || 0)} /kg
          {mixed && <> · {money(unitPriceOfProduct(product))} /u</>}
          {' · '}Stock {formatStock(toQuantityProduct(product), product.stock)}
        </>
      }
      footer={
        <>
          <ModalButton variant="secondary" onClick={() => onKeyPress('Escape')}>Esc — Cancelar</ModalButton>
          <ModalButton variant="brand" onClick={() => onKeyPress('Enter')} disabled={!value}>
            Enter — {editLineId ? 'Guardar' : 'Agregar'}
          </ModalButton>
        </>
      }
    >
      <div className="text-center py-2" data-testid="weight-entry">
        {mixed && !editLineId && (
          <div className="inline-flex rounded-lg overflow-hidden border border-gray-600 text-sm font-semibold mb-4" role="tablist" aria-label="Cómo se vende">
            {(['KG', 'UNIT'] as const).map(option => (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={tab === option}
                onClick={() => { if (tab !== option) onKeyPress('/') }}
                className={`px-4 py-2 transition-colors ${tab === option ? 'bg-blue-600 !text-white' : 'text-gray-400 hover:text-gray-200'}`}
              >
                {option === 'KG' ? 'Por peso' : 'Por unidad'}
              </button>
            ))}
          </div>
        )}

        <p className="text-gray-400 text-sm mb-3">
          {tab === 'UNIT'
            ? 'Ingresá la cantidad de unidades'
            : gramsMode ? 'Ingresá el peso en gramos' : 'Ingresá el peso en kilos'}
        </p>

        <div className="text-6xl font-bold text-white mb-1" aria-live="polite">
          {typed} <span className="text-3xl text-gray-400">{unitLabel}</span>
        </div>

        <div className="text-gray-400 text-sm h-5">
          {value && tab === 'KG' && gramsMode && <>= {formatKg(value.quantity)}</>}
          {!value && editLineId && currentWeightKg != null && <>Peso actual: {formatKg(currentWeightKg)}</>}
        </div>

        <div className="mt-3 text-3xl font-bold text-green-400">{value ? money(subtotal) : '$—'}</div>

        {largeWeightWarning && value && (
          <div className="o-alert o-alert-warning mt-4 text-sm" role="alert">
            ¿Son <strong>{formatKg(value.quantity)}</strong>? Es {LARGE_WEIGHT_KG} kg o más.
            <br />Enter para confirmar · <strong>*</strong> si eran gramos
          </div>
        )}

        <p className="text-gray-500 text-xs mt-4">
          {tab === 'KG' && <><strong>*</strong> cambia entre kg y gramos · </>}
          {mixed && !editLineId && <><strong>/</strong> cambia entre peso y unidades · </>}
          <strong>⌫</strong> borra
        </p>
      </div>
    </Modal>
  )
}
