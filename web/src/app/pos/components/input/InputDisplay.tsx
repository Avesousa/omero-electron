import { formatStock } from '@/lib/quantity'
import { needsWeightEntry, toQuantityProduct, unitPriceOfProduct } from '../../lib/cartLines'
import type { InputMode, Product } from '../../types'
import { STRINGS } from '../../constants/strings'
import { formatMoney } from '@/lib/money'

interface InputDisplayProps {
  mode: InputMode
  currentInput: string
  cashReceived?: string
  currentProduct?: Product | null
}

const STEPS: { mode: InputMode; label: string }[] = [
  { mode: 'code', label: 'Código' },
  { mode: 'quantity', label: 'Cantidad' },
  { mode: 'payment', label: 'Cobrar' },
]

/**
 * El tamaño base del valor es 76px (ver pos.css), pensado para códigos cortos. Un código de barra
 * largo (EAN-13, o uno leído con prefijo/sufijo de la pistola) desbordaba la caja: al no achicarse,
 * el texto rompía línea y agrandaba todo el panel. Se achica en escalones según el largo para que
 * siempre entre en una sola línea y la caja quede de tamaño fijo.
 */
const VALUE_FONT_STEPS: [maxLength: number, px: number][] = [
  [6, 76],
  [9, 56],
  [12, 42],
  [16, 32],
  [20, 24],
]
const MIN_VALUE_FONT_PX = 18

function valueFontSize(length: number): number {
  for (const [maxLength, px] of VALUE_FONT_STEPS) {
    if (length <= maxLength) return px
  }
  return MIN_VALUE_FONT_PX
}

export const InputDisplay = ({ mode, currentInput, cashReceived, currentProduct }: InputDisplayProps) => {
  const getProductInfo = () => {
    if (currentProduct) return currentProduct.name
    const lastProductCode = localStorage.getItem('currentProductCode') || ''
    return lastProductCode ? `Código: ${lastProductCode}` : 'Producto no encontrado'
  }

  const copy = {
    code: { title: 'Ingresá el código', subtitle: 'Tocá + para agregarlo al carrito', hint: 'Usá el teclado numérico o el lector de código de barras' },
    quantity: { title: '¿Cuántas unidades?', subtitle: 'Tocá + para confirmar (vacío = 1)', hint: STRINGS.QUANTITY_BACK_HINT },
    payment: { title: 'Dinero recibido', subtitle: 'Enter para procesar', hint: STRINGS.PAYMENT_HINT },
  }[mode]

  const value = mode === 'payment' ? (cashReceived || '0') : currentInput
  const stepIndex = STEPS.findIndex(s => s.mode === mode)
  const displayState = mode === 'quantity' ? 'is-quantity' : value ? 'is-typing' : ''

  return (
    <div className="pos-card p-6 flex flex-col justify-center gap-5 flex-1 min-h-0">
      {/* Pasos del flujo */}
      <div className="pos-steps" aria-hidden="true">
        {STEPS.map((s, i) => (
          <span key={s.mode} className={`pos-step ${i === stepIndex ? 'is-active' : i < stepIndex ? 'is-done' : ''}`}>
            <b>{i < stepIndex ? '✓' : i + 1}</b>
            {s.label}
          </span>
        ))}
      </div>

      <div className="text-center">
        <div className="text-2xl font-extrabold pos-ink">{copy.title}</div>
        <div className="text-sm font-medium pos-muted mt-1">{copy.subtitle}</div>
      </div>

      {/* Display */}
      <div className={`pos-display text-center ${displayState}`}>
        {mode === 'quantity' && (
          <div className="mb-4">
            <div className="text-xl font-bold pos-ink mb-3">{getProductInfo()}</div>
            {currentProduct && (
              <div className="flex justify-center gap-3 flex-wrap">
                <span className="pos-chip">
                  Precio <b className="pos-ink pos-num">{formatMoney(unitPriceOfProduct(currentProduct))}</b>
                </span>
                <span className={`pos-chip ${currentProduct.stock > 10 ? 'is-ok' : currentProduct.stock > 0 ? 'is-warn' : 'is-bad'}`}>
                  {STRINGS.PRODUCT_STOCK_AVAILABLE}{' '}
                  <b className="pos-num">
                    {needsWeightEntry(currentProduct)
                      ? formatStock(toQuantityProduct(currentProduct), currentProduct.stock)
                      : `${currentProduct.stock} und.`}
                  </b>
                </span>
              </div>
            )}
          </div>
        )}

        <div
          className="pos-display-value pos-num"
          data-testid="pos-input-value"
          style={value ? { fontSize: `${valueFontSize(value.length)}px` } : undefined}
        >
          {value ? value : <span className="pos-display-empty">– – –</span>}
          <span className="pos-caret" aria-hidden="true" />
        </div>

        {mode === 'code' && (
          <div className="text-base font-medium pos-muted mt-3">{STRINGS.CODE_PLACEHOLDER}</div>
        )}
      </div>

      <div className="text-center text-sm pos-muted">{copy.hint}</div>
    </div>
  )
}
