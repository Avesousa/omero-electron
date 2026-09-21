import type { CartItem as CartItemType } from '../../types'
import { STRINGS } from '../../constants/strings'

interface CartItemProps {
  item: CartItemType
  index: number
  displayIndex: number
}

export const CartItem = ({ item, index, displayIndex }: CartItemProps) => {
  return (
    <div className="bg-black border border-gray-600 p-4 hover:border-blue-500 transition-colors">
      <div className="flex items-center justify-between mb-2">
        <div className="w-8 h-8 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center text-sm">
          {displayIndex}
        </div>
        <div className="text-green-400 font-bold text-lg">
          ${(item.total || 0).toLocaleString()}
        </div>
      </div>
      
      <div className="text-white font-medium mb-2 text-sm leading-tight">
        {item.name}
      </div>
      
      <div className="flex justify-between items-center text-xs">
        <span className="text-gray-400">
          {STRINGS.PRODUCT_QUANTITY} {item.quantity}
        </span>
        <span className="text-yellow-400">
          ${(item.price || 0).toLocaleString()} c/u
        </span>
      </div>
    </div>
  )
} 