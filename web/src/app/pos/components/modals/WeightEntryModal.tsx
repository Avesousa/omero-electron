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
          <div className="inline-flex rounded-2xl overflow-hidden border border-[var(--pos-line)] bg-[var(--pos-card-2)] p-1 gap-1 text-sm font-semibold mb-4" role="tablist" aria-label="Cómo se vende">
            {(['KG', 'UNIT'] as const).map(option => (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={tab === option}
                onClick={() => { if (tab !== option) onKeyPress('/') }}
                className={`px-5 py-2 rounded-xl transition-colors ${tab === option ? 'bg-[var(--pos-primary)] !text-white' : 'text-[var(--pos-muted)] hover:text-[var(--pos-ink)]'}`}
              >
                {option === 'KG' ? 'Por peso' : 'Por unidad'}
              </button>
            ))}
          </div>
        )}

        <p className="pos-eyebrow mb-3">
          {tab === 'UNIT'
            ? 'Ingresá la cantidad de unidades'
            : gramsMode ? 'Ingresá el peso en gramos' : 'Ingresá el peso en kilos'}
        </p>

        <div className="pos-entry !border-[var(--pos-primary-2)] !shadow-[0_0_0_6px_var(--pos-primary-soft)]">
          <div className="v pos-num !text-[var(--pos-primary)]" aria-live="polite">
            {typed} <span className="text-3xl text-[var(--pos-muted)]">{unitLabel}</span>
          </div>
        </div>

        <div className="text-[var(--pos-muted)] text-sm h-5 mt-3">
          {value && tab === 'KG' && gramsMode && <>= {formatKg(value.quantity)}</>}
          {!value && editLineId && currentWeightKg != null && <>Peso actual: {formatKg(currentWeightKg)}</>}
        </div>

        <div className="mt-2 pos-num text-4xl font-extrabold text-[var(--pos-success)]">{value ? money(subtotal) : '$—'}</div>

        {largeWeightWarning && value && (
          <div className="o-alert o-alert-warning mt-4 text-sm" role="alert">
            ¿Son <strong>{formatKg(value.quantity)}</strong>? Es {LARGE_WEIGHT_KG} kg o más.
            <br />Enter para confirmar · <strong>*</strong> si eran gramos
          </div>
        )}

        <p className="text-[var(--pos-muted)] text-xs mt-4">
          {tab === 'KG' && <><strong>*</strong> cambia entre kg y gramos · </>}
          {mixed && !editLineId && <><strong>/</strong> cambia entre peso y unidades · </>}
          <strong>⌫</strong> borra
        </p>
      </div>
    </Modal>
  )
}
