import type { CartItem as CartItemType } from '../../types'
import { STRINGS } from '../../constants/strings'
import { isWeightLine, lineQuantityLabel } from '../../lib/cartLines'
import { formatMoney } from '@/lib/money'

interface CartItemProps {
  item: CartItemType
  index: number
  displayIndex: number
}

export const CartItem = ({ item, index, displayIndex }: CartItemProps) => {
  return (
    <div className="pos-card-2 p-4 hover:border-[var(--pos-primary-2)] transition-colors">
      <div className="flex items-center justify-between mb-2">
        <div className="pos-line-idx w-8 h-8 rounded-full font-bold flex items-center justify-center text-sm">
          {displayIndex}
        </div>
        <div className="pos-success pos-num font-bold text-lg">
          {formatMoney(item.total || 0)}
        </div>
      </div>
      
      <div className="text-[var(--pos-ink)] font-medium mb-2 text-sm leading-tight">
        {item.name}
      </div>
      
      <div className="flex justify-between items-center text-xs">
        <span className="text-[var(--pos-muted)]">
          {STRINGS.PRODUCT_QUANTITY} {lineQuantityLabel(item)}
        </span>
        <span className="text-[var(--pos-ink-2)] pos-num">
          {formatMoney(item.price || 0)} {isWeightLine(item) ? '/kg' : 'c/u'}
        </span>
      </div>
    </div>
  )
} 