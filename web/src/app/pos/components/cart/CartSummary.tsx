import { STRINGS } from '../../constants/strings'
import { formatMoney } from '@/lib/money'

interface CartSummaryProps {
  total: number
  itemCount: number
  onFinalizeSale: () => void
  /** Deuda cargada para cobrar (se suma al total a cobrar, pero no es una venta). */
  creditDebt?: number
}

export const CartSummary = ({ total, itemCount, onFinalizeSale, creditDebt = 0 }: CartSummaryProps) => {
  const canFinalize = itemCount > 0 || creditDebt > 0
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1.25fr_1fr] gap-3">
      <div className="pos-total">
        <div className="text-xs font-bold uppercase tracking-wider opacity-80">{STRINGS.CART_TOTAL.replace(':', '')}</div>
        {/* key = total: repite el "bump" cada vez que cambia el importe */}
        <div key={total + creditDebt} className="pos-total-value pos-num is-bump">{formatMoney(total + creditDebt)}</div>
        {creditDebt > 0 && (
          <div className="text-xs font-semibold opacity-90" data-testid="summary-credit">
            Venta {formatMoney(total)} + deuda {formatMoney(creditDebt)}
          </div>
        )}
        <div className="text-sm font-semibold opacity-85">
          {itemCount} {itemCount === 1 ? 'producto' : STRINGS.CART_ITEMS_COUNT}
        </div>
      </div>

      <button onClick={onFinalizeSale} disabled={!canFinalize} className="pos-btn-pay">
        <span>Cobrar</span>
        <small>Tecla Enter</small>
      </button>
    </div>
  )
}
