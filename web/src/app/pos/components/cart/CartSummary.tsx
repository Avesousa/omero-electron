import { STRINGS } from '../../constants/strings'
import { formatMoney } from '@/lib/money'

interface CartSummaryProps {
  total: number
  itemCount: number
  onFinalizeSale: () => void
}

export const CartSummary = ({ total, itemCount, onFinalizeSale }: CartSummaryProps) => {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1.25fr_1fr] gap-3">
      <div className="pos-total">
        <div className="text-xs font-bold uppercase tracking-wider opacity-80">{STRINGS.CART_TOTAL.replace(':', '')}</div>
        {/* key = total: repite el "bump" cada vez que cambia el importe */}
        <div key={total} className="pos-total-value pos-num is-bump">{formatMoney(total)}</div>
        <div className="text-sm font-semibold opacity-85">
          {itemCount} {itemCount === 1 ? 'producto' : STRINGS.CART_ITEMS_COUNT}
        </div>
      </div>

      <button onClick={onFinalizeSale} disabled={itemCount === 0} className="pos-btn-pay">
        <span>Cobrar</span>
        <small>Tecla Enter</small>
      </button>
    </div>
  )
}
