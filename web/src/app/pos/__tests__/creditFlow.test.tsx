/**
 * Flujo de crédito/fiado en la pantalla del POS, con teclas reales: Crédito → elegir cliente por código → monto →
 * finalizar; alta rápida con `+` (también sin conexión); tecla C → deudor → cobro de deuda. Solo se simula el backend
 * (fetch) y lo que no es de este flujo.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
let permissions: string[] = ['POS_CREDITO_USAR']
vi.mock('@/shared/contexts/auth', () => ({ useAuth: () => ({ logout: vi.fn(), user: { permissions } }) }))
vi.mock('../components/ConnectionStatus', () => ({ ConnectionStatus: () => null }))
vi.mock('../components/UpdateBanner', () => ({ UpdateBanner: () => null }))
vi.mock('../../components/ThemeToggle', () => ({ ThemeToggle: () => null }))
vi.mock('../../components/OmeroLogo', () => ({ OmeroLogo: () => null }))

import POSPage from '../page'

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const METHODS = [
  { id: ID(901), kind: 'CASH', name: 'Efectivo', shortcutKey: 2, color: 'green', sortOrder: 1, active: true, isDefault: true },
  { id: ID(902), kind: 'CREDIT', name: 'Crédito', shortcutKey: 3, color: 'violet', sortOrder: 2, active: true, isDefault: false },
]
const PRODUCTS = [{ id: '1', code: '001', name: 'Coca 2L', sellingPrice: 1000, costPrice: 600, stock: 20, barcode: '7790001000019', saleFormat: 'UNIT' }]
const customer = (n: number, code: number, name: string, debt: number) => ({
  id: ID(n), code, name, active: true, extra: {}, debt, pendingLines: debt > 0 ? 1 : 0, oldestPendingAt: null, createdAt: '2026-01-01T00:00:00Z',
})

let customers: ReturnType<typeof customer>[]
let calls: { url: string; method: string; body: any }[]
let quickResponse: () => Response

beforeEach(() => {
  localStorage.clear()
  permissions = ['POS_CREDITO_USAR']
  calls = []
  customers = [customer(1, 42, 'Ana', 0), customer(2, 7, 'Beto', 500), customer(3, 70, 'Carla', 0)]
  quickResponse = () => new Response(JSON.stringify({ success: true, data: customer(9, 99, 'Cliente 99', 0) }), { status: 201 })
  vi.spyOn(session, 'authHeaders').mockReturnValue({})
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const ok = (data: unknown, status = 200) => new Response(JSON.stringify({ success: true, data }), { status })
    if (url.endsWith('/api/sales') && method === 'POST') return ok({ id: 1 }, 201)
    if (url.endsWith('/api/credit/collect') && method === 'POST') return ok({ queued: true, debtAfter: 0, duplicate: false }, 201)
    if (url.endsWith('/api/customers/quick') && method === 'POST') return quickResponse()
    if (url.includes('/api/customers?onlyActive=true')) return ok(customers)
    const detail = /\/api\/customers\/([^/]+)\/detail$/.exec(url)
    if (detail) {
      const c = customers.find(x => x.id === detail[1])!
      return ok({
        customer: c,
        lines: [{ saleItemId: ID(500), saleId: 12, soldAt: '2026-01-02T00:00:00Z', productCode: '001', productName: 'Coca 2L', quantity: 1, originalAmount: 500, paid: 0, currentValue: 500, debt: 500, status: 'PENDING', settledAt: null }],
        collections: [],
      })
    }
    if (url.endsWith('/api/payment-methods/active')) return ok(METHODS)
    if (url.endsWith('/api/products')) return ok(PRODUCTS)
    if (url.endsWith('/api/promotions')) return ok([])
    return new Response(JSON.stringify({ success: false, error: 'no existe' }), { status: 404 })
  }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const CODES: Record<string, string> = { '+': 'NumpadAdd', '.': 'NumpadDecimal' }
function press(keys: string) {
  for (const key of keys.split(' ')) {
    act(() => {
      fireEvent.keyDown(window, /^\d$/.test(key) ? { key, code: `Numpad${key}` } : { key, code: CODES[key] ?? key })
    })
  }
}
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })

async function openPos() {
  render(<POSPage />)
  await waitFor(() => expect(screen.getByTestId('pos-cart')).toBeInTheDocument())
  await flush() // medios de pago, clientes y promociones
}
/** El cobro tiene una pausa de procesamiento: se espera a que la request salga. */
const waitPost = (suffix: string) => waitFor(() => expect(post(suffix)).toBeDefined(), { timeout: 4000 })
const post = (suffix: string) => calls.find(c => c.url.endsWith(suffix) && c.method === 'POST')

describe('POS: venta a crédito', () => {
  it('Crédito pide el cliente, se filtra por código, el monto no da vuelto y la venta lleva customerId', async () => {
    await openPos()
    press('0 0 1 + Enter') // Coca 1000 y a cobrar
    press('3') // Crédito (tecla 3)
    expect(screen.getByTestId('credit-customer-step')).toBeInTheDocument()
    expect(screen.getAllByTestId('customer-row')).toHaveLength(3)

    press('7') // 7 y 70
    expect(screen.getAllByTestId('customer-row')).toHaveLength(2)
    press('0') // 70 → único
    expect(screen.getAllByTestId('customer-row')).toHaveLength(1)
    press('Enter')

    expect(screen.queryByTestId('credit-customer-step')).not.toBeInTheDocument()
    expect(screen.getByTestId('credit-note')).toHaveTextContent('Carla')
    press('1 0 0 0 Enter')
    await waitPost('/api/sales')

    const sale = post('/api/sales')!
    expect(sale.body.customerId).toBe(ID(3))
    expect(sale.body.payments).toEqual([{ paymentMethodId: ID(902), amount: 1000 }])
    expect(sale.body.change).toBe(0)
  })

  it('Crédito sin clientes: + crea uno sin nombre y sigue con el monto', async () => {
    customers = []
    await openPos()
    press('0 0 1 + Enter 3')
    await flush()
    expect(screen.getByTestId('customers-empty')).toBeInTheDocument()
    press('+')
    await flush()
    expect(post('/api/customers/quick')!.body).toEqual({})
    expect(screen.queryByTestId('credit-customer-step')).not.toBeInTheDocument()
    expect(screen.getByTestId('credit-note')).toHaveTextContent('#99')
    press('1 0 0 0 Enter')
    await waitPost('/api/sales')
    expect(post('/api/sales')!.body.customerId).toBe(ID(9))
  })

  it('sin conexión el alta rápida avisa en español y no avanza', async () => {
    customers = []
    quickResponse = () => new Response(JSON.stringify({ success: false, error: 'No se pudo conectar con el servidor.' }), { status: 502 })
    await openPos()
    press('0 0 1 + Enter 3 +')
    await flush()
    expect(await screen.findByText(/Sin conexión: no se puede crear un cliente nuevo/)).toBeInTheDocument()
    expect(screen.getByTestId('credit-customer-step')).toBeInTheDocument()
    expect(post('/api/sales')).toBeUndefined()
  })

  it('sin POS_CREDITO_USAR no se ofrece Crédito y la tecla C avisa', async () => {
    permissions = []
    await openPos()
    press('0 0 1 + Enter')
    expect(screen.queryByRole('button', { name: /Crédito/ })).not.toBeInTheDocument()
    press('Escape C')
    expect(await screen.findByText('No tenés permiso para usar el crédito en la caja.')).toBeInTheDocument()
  })
})

describe('POS: cobro de deuda (tecla C)', () => {
  it('C lista solo deudores, se elige por código, carga las líneas y se cobra con efectivo', async () => {
    await openPos()
    press('C')
    expect(screen.getByText('Clientes con crédito')).toBeInTheDocument()
    expect(screen.getAllByTestId('customer-row')).toHaveLength(1) // solo Beto debe
    press('7 Enter')
    await flush()
    expect(await screen.findByTestId('credit-lines')).toHaveTextContent('Beto')
    expect(screen.getByTestId('summary-credit')).toBeInTheDocument()

    press('Enter') // cobrar → paso del monto
    expect(screen.getByTestId('collect-step')).toBeInTheDocument()
    press('Enter') // vacío = toda la deuda
    expect(screen.getByTestId('collect-breakdown')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Crédito/ })).not.toBeInTheDocument() // no se fía una cobranza
    press('2') // Efectivo
    press('5 0 0 Enter')
    await waitPost('/api/credit/collect')

    const collect = post('/api/credit/collect')!
    expect(collect.body).toMatchObject({ customerId: ID(2), expectedDebt: 500, payments: [{ paymentMethodId: ID(901), amount: 500 }] })
    expect(collect.body.clientId).toMatch(/^[0-9a-f-]{36}$/)
    expect(post('/api/sales')).toBeUndefined()
    expect(await screen.findByText(/El cliente quedó sin deuda/)).toBeInTheDocument()
  })

  it('un cobro parcial: el monto se escribe en el paso previo y la deuda restante se informa', async () => {
    await openPos()
    press('C 7 Enter')
    await flush()
    press('Enter 2 0 0 Enter 2 2 0 0 Enter')
    await waitPost('/api/credit/collect')
    expect(post('/api/credit/collect')!.body.payments).toEqual([{ paymentMethodId: ID(901), amount: 200 }])
  })
})
