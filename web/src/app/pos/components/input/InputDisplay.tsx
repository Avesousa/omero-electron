import type { InputMode, Product } from '../../types'
import { STRINGS } from '../../constants/strings'

interface InputDisplayProps {
  mode: InputMode
  currentInput: string
  cashReceived?: string
  currentProduct?: Product | null
}

export const InputDisplay = ({ mode, currentInput, cashReceived, currentProduct }: InputDisplayProps) => {
  const getModeConfig = () => {
    switch (mode) {
      case 'code':
        return {
          title: STRINGS.INPUT_CODE_TITLE,
          subtitle: STRINGS.INPUT_CODE_SUBTITLE,
          placeholder: STRINGS.CODE_PLACEHOLDER,
          hint: "Use el teclado numérico para ingresar el código",
          borderColor: 'border-yellow-500',
          textColor: 'text-yellow-400',
          titleColor: 'text-yellow-400',
          subtitleColor: 'text-yellow-300'
        }
      case 'quantity':
        return {
          title: STRINGS.INPUT_QUANTITY_TITLE,
          subtitle: STRINGS.INPUT_QUANTITY_SUBTITLE,
          placeholder: getProductInfo(),
          hint: STRINGS.QUANTITY_HINT,
          backHint: STRINGS.QUANTITY_BACK_HINT,
          borderColor: 'border-blue-500',
          textColor: 'text-blue-400',
          titleColor: 'text-blue-400',
          subtitleColor: 'text-blue-300'
        }
      case 'payment':
        return {
          title: STRINGS.INPUT_PAYMENT_TITLE,
          subtitle: STRINGS.INPUT_PAYMENT_SUBTITLE,
          placeholder: '',
          hint: STRINGS.PAYMENT_HINT,
          borderColor: 'border-green-500',
          textColor: 'text-green-400',
          titleColor: 'text-green-400',
          subtitleColor: 'text-green-300'
        }
    }
  }

  const getProductInfo = () => {
    if (currentProduct) {
      return currentProduct.name
    }
    
    const lastProductCode = localStorage.getItem('currentProductCode') || ''
    return lastProductCode ? `Código: ${lastProductCode}` : 'Producto no encontrado'
  }

  const config = getModeConfig()

  const getDisplayValue = () => {
    if (mode === 'payment') {
      return cashReceived || '0.00'
    }
    return currentInput || '---'
  }

  return (
    <div>
      {/* Texto dinámico encima del input */}
      <div className="text-center mb-4">
        <div className={`text-lg font-bold mb-2 ${config.titleColor}`}>
          {config.title}
        </div>
        <div className={`text-sm ${config.subtitleColor}`}>
          {config.subtitle}
        </div>
      </div>

      {/* Input Display */}
      <div className={`bg-gray-900 border-4 p-8 mb-6 ${config.borderColor}`}>
        <div className="text-center">
          {/* Product info for quantity mode */}
          {mode === 'quantity' && currentProduct && (
            <div className="mb-6">
              <div className="text-2xl font-bold text-white mb-2">
                {currentProduct.name}
              </div>
              <div className="flex justify-center items-center space-x-6 text-sm">
                <div className="bg-black border-2 border-blue-500 px-4 py-2 rounded">
                  <span className="text-blue-300">Precio: </span>
                  <span className="text-white font-bold">${(currentProduct.price || 0).toLocaleString()}</span>
                </div>
                <div className="bg-black border-2 border-green-500 px-4 py-2 rounded">
                  <span className="text-green-300">{STRINGS.PRODUCT_STOCK_AVAILABLE} </span>
                  <span className={`font-bold ${currentProduct.stock > 10 ? 'text-green-400' : currentProduct.stock > 0 ? 'text-yellow-400' : 'text-red-400'}`}>
                    {currentProduct.stock} und.
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Input value display */}
          <div className={`text-6xl font-bold mb-4 ${config.textColor}`}>
            {getDisplayValue()}
          </div>
          
          {/* Mode-specific placeholder/hint */}
          {mode !== 'quantity' && (
            <div className="text-lg text-gray-300 mb-4">
              {config.placeholder}
            </div>
          )}
        </div>
      </div>

      {/* Text below input */}
      <div className="text-center space-y-2">
        <div className="text-gray-300">
          {config.hint}
        </div>
        {config.backHint && (
          <div className="text-yellow-300 text-sm">
            {config.backHint}
          </div>
        )}
      </div>
    </div>
  )
} 