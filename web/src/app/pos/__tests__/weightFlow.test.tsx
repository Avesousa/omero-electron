/**
 * Flujo completo en la pantalla del POS: productos por peso, por unidad y peso, y etiquetas de balanza, todo con el
 * teclado numérico. Solo se simulan el backend (fetch) y lo que no es de este flujo (MercadoPago, sesión, conexión).
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { withCheckDigit } from '@/lib/scale'
import { formatMoney } from '@/lib/money'
import * as session from '@/lib/sessionManager'

vi.mock('../hooks/useMercadoPagoEvents', () => ({
  useMercadoPagoEvents: () => ({ isConnected: false, sseConnected: false, mpConnected: false, lastPayment: null, lastPaymentTime: null, clearLastPayment: vi.fn() }),
}))
vi.mock('../hooks/useMercadoPagoPolling', () => ({ useMercadoPagoPolling: () => ({ triggerPollingIfNeeded: vi.fn() }) }))
vi.mock('../hooks/useConnectionStatus', () => ({
  useConnectionStatus: () => ({ runtime: 'web', online: true, cache: null, checking: false, lastCheckedAt: null, check: vi.fn() }),
}))
vi.mock('../hooks/useOutboxStatus', () => ({
  useOutboxStatus: () => ({ counts: { pending: 0, review: 0, failed: 0 }, backend: null, items: [], refresh: vi.fn(), dismiss: vi.fn() }),
}))
vi.mock('../hooks/useOfflineQueue', () => ({ useOfflineQueue: () => ({ legacyPending: 0 }) }))
vi.mock('../hooks/useUpdateAvailable', () => ({ useUpdateAvailable: () => null }))
vi.mock('@/lib/useEntitlement', () => ({ useEntitlement: () => ({ blocked: false, refresh: vi.fn() }) }))
vi.mock('@/shared/contexts/auth', () => ({ useAuth: () => ({ logout: vi.fn() }) }))
vi.mock('../components/ConnectionStatus', () => ({ ConnectionStatus: () => null }))
vi.mock('../components/UpdateBanner', () => ({ UpdateBanner: () => null }))
vi.mock('../../components/ThemeToggle', () => ({ ThemeToggle: () => null }))
vi.mock('../../components/OmeroLogo', () => ({ OmeroLogo: () => null }))

import POSPage from '../page'

const PRODUCTS = [
  { id: '1', code: '001', name: 'Coca 2L', sellingPrice: 1000, costPrice: 600, stock: 20, barcode: '7790001000019', saleFormat: 'UNIT' },
  { id: '2', code: '002', name: 'Queso cremoso', sellingPrice: 8000, costPrice: 5000, stock: 12.5, barcode: null, saleFormat: 'GRAMS', scalePlu: 123 },
  { id: '3', code: '003', name: 'Pan de campo', sellingPrice: 4000, costPrice: 2000, stock: 1, barcode: null, saleFormat: 'MIXED', unitWeightKg: 0.25, unitPrice: 1200, effectiveUnitPrice: 1200, scalePlu: 7 },
]
/** Etiqueta Systel de fábrica: 20 + PLU + importe con 2 decimales. */
const LABEL_QUESO_4200 = withCheckDigit('200123420000')

let scale: Record<string, string>
let sales: any[]

beforeEach(() => {
  localStorage.clear()
  scale = { scale_enabled: 'true' }
  sales = []
  vi.spyOn(session, 'authHeaders').mockReturnValue({})
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo, init?: RequestInit) => {
    const url = String(input)
    const ok = (data: unknown, status = 200) => new Response(JSON.stringify({ success: true, data }), { status })
    if (url.endsWith('/api/sales') && init?.method === 'POST') {
      sales.push(JSON.parse(String(init.body)))
      return ok({ id: 1 }, 201)
    }
    if (url.endsWith('/api/products')) return ok(PRODUCTS)
    if (url.endsWith('/api/promotions')) return ok([])
    const key = /\/api\/business\/config\/(\w+)$/.exec(url)?.[1]
    if (key && key in scale) return ok({ key, value: scale[key] })
    return new Response(JSON.stringify({ success: false, error: 'no existe' }), { status: 404 })
  }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const CODES: Record<string, string> = { '+': 'NumpadAdd', '*': 'NumpadMultiply', '/': 'NumpadDivide', '.': 'NumpadDecimal', '-': 'NumpadSubtract' }
/** Teclea una secuencia separada por espacios, como llega del teclado numérico. */
function press(keys: string) {
  for (const key of keys.split(' ')) {
    act(() => {
      fireEvent.keyDown(window, /^\d$/.test(key) ? { key, code: `Numpad${key}` } : { key, code: CODES[key] ?? key })
    })
  }
}

async function openPos() {
  render(<POSPage />)
  await waitFor(() => expect(screen.getByTestId('pos-cart')).toBeInTheDocument())
  await act(async () => { await new Promise(r => setTimeout(r, 0)) }) // promociones y configuración de balanza
}
const panel = () => screen.queryByTestId('weight-entry')
/** Los importes del carrito usan el formato regional del equipo (como en la caja). */
const $ = (n: number) => formatMoney(n)
/** Para getByText, que normaliza los espacios duros del símbolo. */
const text$ = (n: number) => $(n).replace(/\u00a0/g, ' ')
const cartText = () => screen.getByTestId('pos-cart').textContent ?? ''

describe('POS: productos por peso', () => {
  it('un producto por unidad se agrega como siempre, sin panel', async () => {
    await openPos()
    press('0 0 1 +')
    expect(panel()).not.toBeInTheDocument()
    expect(cartText()).toContain('Coca 2L')
    expect(cartText()).toContain('(1 unid.)')
  })

  it('un producto por peso exige cargar el peso antes de entrar al carrito', async () => {
    await openPos()
    press('0 0 2 +')
    expect(panel()).toBeInTheDocument()
    expect(screen.getByText('Ingresá el peso en kilos')).toBeInTheDocument()
    expect(cartText()).toContain('Carrito vacío')

    press('Enter') // sin peso no se agrega
    expect(panel()).toBeInTheDocument()
    expect(screen.getByText('Ingresá el peso para agregar el producto')).toBeInTheDocument()
    expect(cartText()).toContain('Carrito vacío')

    press('0 . 3 5 Enter')
    expect(panel()).not.toBeInTheDocument()
    expect(cartText()).toContain('Queso cremoso')
    expect(cartText()).toContain('0,350 kg')
    expect(cartText()).toContain(`${$(8000)} /kg`)
    expect(cartText()).toContain($(2800))
  })

  it('mientras el panel está abierto, las teclas no llegan al resto del POS; Esc cancela', async () => {
    await openPos()
    press('0 0 2 +')
    press('- Tab') // "-" abriría el borrado y Tab el resumen
    expect(panel()).toBeInTheDocument()
    expect(screen.queryByText('ELIMINAR PRODUCTO')).not.toBeInTheDocument()
    press('1 Escape')
    expect(panel()).not.toBeInTheDocument()
    expect(cartText()).toContain('Carrito vacío')
  })

  it('en gramos (*), y la caja recuerda la unidad para la próxima pesada', async () => {
    await openPos()
    press('0 0 2 + * 3 5 0')
    expect(screen.getByText('= 0,350 kg')).toBeInTheDocument()
    press('Enter')
    expect(cartText()).toContain('0,350 kg')
    press('0 0 2 +')
    expect(screen.getByText('Ingresá el peso en gramos')).toBeInTheDocument()
  })

  it('dos pesadas del mismo producto son dos líneas', async () => {
    await openPos()
    press('0 0 2 + 0 . 3 Enter')
    press('0 0 2 + 1 . 2 Enter')
    expect(cartText()).toContain('0,300 kg')
    expect(cartText()).toContain('1,200 kg')
    expect(cartText()).toContain('2 productos')
    expect(screen.getByText(text$(12000))).toBeInTheDocument() // 2.400 + 9.600
  })

  it('* sobre la última pesada reabre el panel para corregir el peso', async () => {
    await openPos()
    press('0 0 2 + 0 . 3 5 Enter *')
    expect(screen.getByText('Corregir peso · Queso cremoso')).toBeInTheDocument()
    expect(screen.getByText('Peso actual: 0,350 kg')).toBeInTheDocument()
    press('0 . 5 Enter')
    expect(cartText()).toContain('0,500 kg')
    expect(cartText()).not.toContain('0,350 kg')
    expect(cartText()).toContain('1 producto')
  })

  it('no deja vender más kilos que el stock', async () => {
    await openPos()
    press('0 0 2 + 1 3 Enter')
    expect(screen.getByText('Stock insuficiente. Disponible: 12,500 kg')).toBeInTheDocument()
    expect(panel()).toBeInTheDocument()
    expect(cartText()).toContain('Carrito vacío')
  })

  it('100 kg o más pide confirmar dos veces', async () => {
    await openPos()
    press('0 0 2 + 3 5 0 Enter')
    expect(within(panel()!).getByRole('alert')).toHaveTextContent('350,000 kg')
    expect(cartText()).toContain('Carrito vacío')
    press('* 3 5 0 Enter') // eran gramos
    expect(cartText()).toContain('0,350 kg')
  })
})

describe('POS: productos por unidad y peso', () => {
  it('se puede vender por peso o por unidad (/), y el stock es uno solo en kilos', async () => {
    await openPos()
    press('0 0 3 +')
    expect(screen.getByRole('tab', { name: 'Por peso' })).toHaveAttribute('aria-selected', 'true')
    press('/ 2 Enter') // 2 unidades = 0,5 kg
    expect(cartText()).toContain('(2 unid.)')
    expect(cartText()).toContain($(2400))

    press('0 0 3 +') // recuerda la pestaña de unidades
    expect(screen.getByRole('tab', { name: 'Por unidad' })).toHaveAttribute('aria-selected', 'true')
    press('/ 0 . 6 Enter') // queda 0,5 kg
    expect(screen.getByText(/Stock insuficiente\. Disponible: 0,500 kg/)).toBeInTheDocument()
    press('Backspace 5 Enter')
    expect(cartText()).toContain('0,500 kg')
    expect(cartText()).toContain('2 productos')
  })

  it('* sobre la línea por unidad cambia la cantidad validando el stock en kilos', async () => {
    await openPos()
    press('0 0 3 + / 1 Enter')
    press('* 5 +') // 5 unidades = 1,25 kg > 1 kg
    expect(screen.getByText(/Stock insuficiente/)).toBeInTheDocument()
    press('Backspace 4 +') // 4 unidades = 1 kg
    expect(cartText()).toContain('(4 unid.)')
    expect(cartText()).toContain($(4800))
  })
})

describe('POS: etiquetas de balanza', () => {
  it('una etiqueta con importe entra sola al carrito, sin pedir el peso, y cobra el importe impreso', async () => {
    await openPos()
    press(LABEL_QUESO_4200.split('').join(' '))
    expect(panel()).not.toBeInTheDocument()
    expect(cartText()).toContain('Queso cremoso')
    expect(cartText()).toContain('Etiqueta')
    expect(cartText()).toContain('0,525 kg')
    expect(cartText()).toContain($(4200))
  })

  it('PLU desconocido: avisa y no agrega nada', async () => {
    await openPos()
    press(withCheckDigit('200999100000').split('').join(' '))
    expect(screen.getByText(/no hay ningún producto con el código de balanza 999/)).toBeInTheDocument()
    expect(cartText()).toContain('Carrito vacío')
  })

  it('con la balanza desactivada un código de 13 dígitos es un código de barras común', async () => {
    scale = { scale_enabled: 'false' }
    await openPos()
    press(LABEL_QUESO_4200.split('').join(' '))
    expect(cartText()).toContain('Carrito vacío')
    press('Backspace '.repeat(13).trim())
    press('7 7 9 0 0 0 1 0 0 0 0 1 9') // código de barras real de la Coca
    expect(cartText()).toContain('Coca 2L')
  })

})

describe('POS: la venta', () => {
  it('manda cada línea con su unidad, los kilos y el importe cobrado', async () => {
    await openPos()
    press('0 0 1 +')
    press('0 0 2 + 0 . 3 5 Enter')
    press('0 0 3 + / 2 Enter')
    press(LABEL_QUESO_4200.split('').join(' '))
    expect(screen.getByText(text$(10400))).toBeInTheDocument() // 1.000 + 2.800 + 2.400 + 4.200

    press('Enter 2') // cobrar → efectivo
    press('1 0 4 0 0 Enter')
    await waitFor(() => expect(sales).toHaveLength(1), { timeout: 4000 }).catch(async () => {
      press('Enter')
      await waitFor(() => expect(sales).toHaveLength(1), { timeout: 4000 })
    })
    expect(sales[0].items).toEqual([
      { productId: '001', productName: 'Coca 2L', quantity: 1, unitPrice: 1000, total: 1000, promotionId: null, promotionName: null, saleUnit: 'UNIT', stockQuantity: 1 },
      { productId: '002', productName: 'Queso cremoso', quantity: 0.35, unitPrice: 8000, total: 2800, promotionId: null, promotionName: null, saleUnit: 'KG', stockQuantity: 0.35 },
      { productId: '003', productName: 'Pan de campo', quantity: 2, unitPrice: 1200, total: 2400, promotionId: null, promotionName: null, saleUnit: 'UNIT', stockQuantity: 0.5 },
      { productId: '002', productName: 'Queso cremoso', quantity: 0.525, unitPrice: 8000, total: 4200, promotionId: null, promotionName: null, saleUnit: 'KG', stockQuantity: 0.525 },
    ])
    expect(sales[0]).toMatchObject({ cashAmount: 10400, mpAmount: 0, change: 0 })
  })
})
