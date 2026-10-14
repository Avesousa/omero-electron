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

type Tone = 'blue' | 'green' | 'orange' | 'red' | 'violet' | 'mp' | 'gray'
type GuideKey = { key: string; label: string; tone: Tone }

const GUIDES: Record<NonNullable<KeyboardGuideProps['variant']>, GuideKey[]> = {
  payment: [
    { key: '0-9', label: STRINGS.KEY_WRITE, tone: 'blue' },
    { key: 'Enter', label: STRINGS.KEY_PAY, tone: 'green' },
    { key: 'Esc', label: STRINGS.KEY_BACK, tone: 'gray' },
    { key: '⌫', label: STRINGS.KEY_BACKSPACE, tone: 'red' },
  ],
  delete: [
    { key: '0-9', label: STRINGS.KEY_WRITE, tone: 'violet' },
    { key: '-', label: STRINGS.KEY_DELETE, tone: 'red' },
    { key: '⌫', label: STRINGS.KEY_BACKSPACE, tone: 'orange' },
    { key: 'Esc', label: STRINGS.KEY_EXIT, tone: 'gray' },
  ],
  expense: [
    { key: '0-9', label: STRINGS.KEY_WRITE, tone: 'blue' },
    { key: 'Enter', label: 'Confirmar', tone: 'green' },
    { key: 'Esc', label: STRINGS.KEY_BACK, tone: 'gray' },
    { key: '⌫', label: STRINGS.KEY_BACKSPACE, tone: 'red' },
  ],
  products: [
    { key: '0-9', label: 'Buscar', tone: 'blue' },
    { key: 'Esc', label: STRINGS.KEY_BACK, tone: 'gray' },
    { key: '⌫', label: STRINGS.KEY_BACKSPACE, tone: 'red' },
  ],
  main: [
    { key: '+', label: STRINGS.KEY_ADD, tone: 'green' },
    { key: 'Enter', label: 'Cobrar', tone: 'orange' },
    { key: '*', label: 'Cantidad', tone: 'blue' },
    { key: '/', label: 'Productos', tone: 'violet' },
    { key: '.', label: 'Gasto', tone: 'red' },
    { key: '-', label: STRINGS.KEY_DELETE, tone: 'red' },
    { key: 'Tab', label: 'Resumen', tone: 'blue' },
    { key: 'T', label: 'Mercado Pago', tone: 'mp' },
    { key: 'Esc', label: STRINGS.KEY_BACK, tone: 'gray' },
    { key: '⌫', label: STRINGS.KEY_BACKSPACE, tone: 'gray' },
  ],
}

export const KeyboardGuide = ({ variant = 'main', onKeyPress }: KeyboardGuideProps) => {
  const keys = GUIDES[variant]

  const handleClick = (key: string) => {
    if (!onKeyPress) return
    onKeyPress(DISPLAY_TO_ACTION[key] ?? key)
  }

  // Teclas que representan rangos (no disparan una acción única)
  const isRange = (key: string) => key.includes('-') && key !== '-'

  return (
    <div className="pos-keys">
      {keys.map(({ key, label, tone }) => {
        const clickable = Boolean(onKeyPress) && !isRange(key)
        return (
          <div
            key={key}
            className={`pos-key k-${tone} ${clickable ? '' : 'is-static'}`}
            onClick={clickable ? () => handleClick(key) : undefined}
          >
            <span className="pos-key-glyph">{key}</span>
            <span className="pos-key-label">{label}</span>
          </div>
        )
      })}
    </div>
  )
}
