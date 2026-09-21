import type { CartItem as CartItemType } from '../../types'
import { STRINGS } from '../../constants/strings'

interface CartListProps {
  cart: CartItemType[]
}

export const CartList = ({ cart }: CartListProps) => {
  if (cart.length === 0) {
    return (
      <div className="text-center text-gray-400 py-8">
        <div className="text-4xl mb-4">🛒</div>
        <div className="text-lg">{STRINGS.CART_EMPTY}</div>
      </div>
    )
  }

  return (
    <div>
      <div className="text-xs text-gray-400 text-center mb-3">
        📦 {cart.length} productos • Scroll para ver más ↕️
      </div>
      <div className="space-y-2 pr-2">
        {[...cart].reverse().map((item, reverseIndex) => {
          const displayIndex = reverseIndex + 1
          return (
            <div key={item.id} className="bg-gray-800 border-2 border-gray-600 p-4 hover:border-blue-500 transition-colors">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center space-x-4 flex-1 min-w-0">
                  <div className="w-10 h-10 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center text-base flex-shrink-0">
                    {displayIndex}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="text-white font-bold text-lg truncate">{item.name}</div>
                      {item.promotionId && (
                        <span className="px-2 py-0.5 bg-purple-500 text-white text-xs rounded font-semibold flex-shrink-0">
                          🎯 PROMO
                        </span>
                      )}
                    </div>
                    <div className="text-gray-300 text-sm">
                      <span className="font-mono">#{item.code.startsWith('000') ? '000' : item.code}</span>
                      <span className="mx-2">|</span>
                      <span className="font-semibold">{item.quantity}</span>
                      <span className="mx-1">x</span>
                      <span className="font-mono">${(item.price || 0).toLocaleString()}</span>
                      {item.originalPrice && item.originalPrice !== item.price && (
                        <span className="text-gray-500 line-through ml-2">
                          ${(item.originalPrice || 0).toLocaleString()}
                        </span>
                      )}
                    </div>
                    {item.promotionName && (
                      <div className="text-purple-400 text-xs mt-1 truncate">
                        {item.promotionName}
                      </div>
                    )}
                  </div>
                </div>
                <div className="text-right flex-shrink-0 min-w-[140px]">
                  <div className="text-2xl font-bold text-green-400 font-mono">
                    ${(item.total || 0).toLocaleString()}
                  </div>
                  <div className="text-xs text-gray-400 mt-1">
                    ({item.quantity} unid.)
                  </div>
                  {item.originalPrice && item.originalPrice !== item.price && (
                    <div className="text-xs text-green-300 mt-1 font-semibold">
                      Ahorro: ${(((item.originalPrice || 0) - (item.price || 0)) * item.quantity).toLocaleString()}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  )
} 