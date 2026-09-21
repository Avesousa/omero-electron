import { STRINGS } from '../../constants/strings'

interface KeyboardGuideProps {
  variant?: 'main' | 'payment' | 'delete' | 'expense' | 'products'
  onKeyPress?: (key: string) => void
}

// Mapea el símbolo visual al valor real que recibe handleKeyPress
const DISPLAY_TO_ACTION: Record<string, string> = {
  '⌫': 'Backspace',
  'Esc': 'Escape',
}

export const KeyboardGuide = ({ variant = 'main', onKeyPress }: KeyboardGuideProps) => {
  const getGuideConfig = () => {
    switch (variant) {
      case 'payment':
        return {
          keys: [
            { key: '0-9', label: STRINGS.KEY_WRITE, color: 'text-yellow-400' },
            { key: 'Enter', label: STRINGS.KEY_PAY, color: 'text-green-400' },
            { key: 'Esc', label: STRINGS.KEY_BACK, color: 'text-blue-400' },
            { key: '⌫', label: STRINGS.KEY_BACKSPACE, color: 'text-red-400' }
          ]
        }
      case 'delete':
        return {
          keys: [
            { key: '0-9', label: STRINGS.KEY_WRITE, color: 'text-purple-400' },
            { key: '-', label: STRINGS.KEY_DELETE, color: 'text-red-400' },
            { key: '⌫', label: STRINGS.KEY_BACKSPACE, color: 'text-yellow-400' },
            { key: 'Esc', label: STRINGS.KEY_EXIT, color: 'text-gray-400' }
          ]
        }
      case 'expense':
        return {
          keys: [
            { key: '0-9', label: STRINGS.KEY_WRITE, color: 'text-yellow-400' },
            { key: 'Enter', label: 'Confirmar', color: 'text-green-400' },
            { key: 'Esc', label: STRINGS.KEY_BACK, color: 'text-gray-400' },
            { key: '⌫', label: STRINGS.KEY_BACKSPACE, color: 'text-red-400' }
          ]
        }
      case 'products':
        return {
          keys: [
            { key: '0-9', label: 'Buscar', color: 'text-yellow-400' },
            { key: 'Esc', label: STRINGS.KEY_BACK, color: 'text-gray-400' },
            { key: '⌫', label: STRINGS.KEY_BACKSPACE, color: 'text-red-400' }
          ]
        }
      default:
        return {
          keys: [
            { key: '+', label: STRINGS.KEY_ADD, color: 'text-green-400' },
            { key: 'Enter', label: STRINGS.KEY_FINALIZE, color: 'text-blue-400' },
            { key: '/', label: 'Productos', color: 'text-purple-400' },
            { key: '.', label: 'Gasto', color: 'text-red-400' },
            { key: '*', label: 'Multiplicar', color: 'text-blue-400' },
            { key: '-', label: STRINGS.KEY_DELETE, color: 'text-purple-400' },
            { key: 'Tab', label: 'Resumen', color: 'text-cyan-400' },
            { key: 'T', label: 'MP', color: 'text-cyan-400' },
            { key: 'Esc', label: STRINGS.KEY_BACK, color: 'text-gray-400' },
            { key: '⌫', label: STRINGS.KEY_BACKSPACE, color: 'text-orange-400' }
          ]
        }
    }
  }

  const { keys } = getGuideConfig()

  const handleClick = (key: string) => {
    if (!onKeyPress) return
    const action = DISPLAY_TO_ACTION[key] ?? key
    onKeyPress(action)
  }

  // Teclas que representan rangos (no disparan una acción única)
  const isRange = (key: string) => key.includes('-') && key !== '-'

  return (
    <div className="bg-gray-800 border-2 border-gray-600 p-3">
      <div className="flex flex-wrap justify-center gap-2">
        {keys.map(({ key, label, color }, index) => {
          const clickable = onKeyPress && !isRange(key)
          return (
            <div
              key={index}
              className={`flex flex-col items-center justify-center w-20 h-16 px-2 py-2 bg-gray-900 border-2 border-gray-600 rounded ${clickable ? 'cursor-pointer hover:border-gray-400 hover:bg-gray-700 active:scale-95 active:bg-gray-600 transition-all' : 'opacity-60'}`}
              onClick={clickable ? () => handleClick(key) : undefined}
            >
              <span className={`${color} font-bold text-xl flex items-center justify-center h-6`}>{key}</span>
              <span className="text-gray-400 text-xs flex items-center justify-center h-4 mt-1">{label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
} 