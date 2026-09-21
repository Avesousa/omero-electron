import { STRINGS } from '../../constants/strings'

interface CartSummaryProps {
  total: number
  itemCount: number
  onFinalizeSale: () => void
}

export const CartSummary = ({ total, itemCount, onFinalizeSale }: CartSummaryProps) => {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Total */}
      <div className="bg-black border-2 border-yellow-500 p-3 text-center">
        <div className="text-sm text-gray-300 mb-1">{STRINGS.CART_TOTAL}</div>
        <div className="text-2xl font-bold text-yellow-400">
          ${total.toLocaleString()}
        </div>
        <div className="text-xs text-gray-400 mt-1">
          {itemCount} {STRINGS.CART_ITEMS_COUNT}
        </div>
      </div>

      {/* Finalize Sale Button */}
      <div className="flex flex-col justify-center">
        <div className="text-center mb-1">
          <div className="text-xs text-gray-300">PRESIONE ENTER PARA FINALIZAR</div>
        </div>
        <button
          onClick={onFinalizeSale}
          disabled={itemCount === 0}
          className={`w-full font-bold py-3 px-4 text-base border-2 transition-colors ${
            itemCount > 0
              ? 'bg-green-600 border-green-400 text-white hover:bg-green-700'
              : 'bg-gray-600 border-gray-500 text-gray-400 cursor-not-allowed'
          }`}
        >
          💳 {STRINGS.BTN_FINALIZE_SALE}
        </button>
      </div>
    </div>
  )
} 