import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { usePromotions } from '../usePromotions'
import { setTenantTimeZone, DEFAULT_TENANT_TZ } from '@/lib/tenantTime'
import { apiFetch } from '@/lib/apiClient'
import type { CartItem } from '../../types'

vi.mock('@/lib/apiClient', () => ({ apiFetch: vi.fn() }))

const line = (code: string, quantity: number, price = 1500): CartItem => ({
  id: code, code, name: code, price, quantity, total: price * quantity,
})
const prod = (productCode: string, promotionalPrice: number, minQuantity = 1) => ({
  productCode, productName: productCode, promotionalPrice, minQuantity,
})
const volume = (extra: Record<string, unknown>, products = [prod('A', 1000, 1)]) => ({
  id: 'p1', name: 'Promo', type: 'VOLUME', status: 'ACTIVE', products, ...extra,
})

async function load(promos: unknown[]) {
  vi.mocked(apiFetch).mockResolvedValue({ success: true, data: promos } as never)
  const hook = renderHook(() => usePromotions())
  await waitFor(() => expect(hook.result.current.loading).toBe(false))
  return hook
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); setTenantTimeZone(DEFAULT_TENANT_TZ, null) })
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

describe('usePromotions: vigencia', () => {
  it('promo vieja sin campos de vigencia: se aplica como siempre', async () => {
    vi.setSystemTime(new Date('2026-11-25T15:00:00Z'))
    const { result } = await load([volume({})])
    const out = result.current.applyPromotions([line('A', 1)])
    expect(out[0].price).toBe(1000)
    expect(out[0].promotionId).toBe('p1')
  })

  it('fuera de las fechas: no se detecta ni se aplica', async () => {
    vi.setSystemTime(new Date('2026-11-25T15:00:00Z'))
    const { result } = await load([volume({ startsAt: '2026-12-01T03:00:00Z' })])
    expect(result.current.detectApplicablePromotions([line('A', 1)])).toHaveLength(0)
    expect(result.current.applyPromotions([line('A', 1)])[0].price).toBe(1500)
  })

  it('el horario se evalúa en la zona del negocio, no en la del equipo', async () => {
    // 01:30Z = 22:30 en Buenos Aires (miércoles) pero 01:30 en UTC (jueves).
    vi.setSystemTime(new Date('2026-11-26T01:30:00Z'))
    const promo = volume({ days: [3], timeFrom: '22:00', timeTo: '23:00' })
    const ba = await load([promo])
    expect(ba.result.current.applyPromotions([line('A', 1)])[0].price).toBe(1000)
    ba.unmount()

    setTenantTimeZone('UTC', null)
    const utc = await load([promo])
    expect(utc.result.current.applyPromotions([line('A', 1)])[0].price).toBe(1500)
  })

  it('borde de horario: 23:00 justas ya no aplica; 22:59 sí', async () => {
    const promo = volume({ timeFrom: '18:00', timeTo: '23:00' })
    const { result } = await load([promo])
    vi.setSystemTime(new Date('2026-11-26T01:59:00Z')) // 22:59 BA
    expect(result.current.applyPromotions([line('A', 1)])[0].price).toBe(1000)
    vi.setSystemTime(new Date('2026-11-26T02:00:00Z')) // 23:00 BA
    expect(result.current.applyPromotions([line('A', 1)])[0].price).toBe(1500)
  })

  it('se re-evalúa con el paso del tiempo sin volver a pedir las promos', async () => {
    vi.setSystemTime(new Date('2026-11-25T14:00:00Z')) // 11:00 BA
    const { result } = await load([volume({ timeFrom: '12:00', timeTo: '14:00' })])
    expect(result.current.applyPromotions([line('A', 1)])[0].price).toBe(1500)
    act(() => { vi.setSystemTime(new Date('2026-11-25T16:00:00Z')) }) // 13:00 BA
    expect(result.current.applyPromotions([line('A', 1)])[0].price).toBe(1000)
  })

  it('no confía en el campo schedule del backend', async () => {
    vi.setSystemTime(new Date('2026-11-25T15:00:00Z'))
    const { result } = await load([volume({ schedule: 'EXPIRED' })])
    expect(result.current.applyPromotions([line('A', 1)])[0].price).toBe(1000)
  })
})

describe('usePromotions: escalones VOLUME', () => {
  const tiers = [prod('A', 1200, 3), prod('A', 1000, 6)]
  const price = (qty: number, result: ReturnType<typeof usePromotions>) =>
    result.applyPromotions([line('A', qty)])[0]

  it.each([
    [2, 1500, undefined], [3, 1200, 'p1'], [5, 1200, 'p1'], [6, 1000, 'p1'], [20, 1000, 'p1'],
  ])('cantidad %i -> precio %i', async (qty, expected, promoId) => {
    vi.setSystemTime(new Date('2026-11-25T15:00:00Z'))
    const { result } = await load([volume({}, tiers)])
    const out = price(qty, result.current)
    expect(out.price).toBe(expected)
    expect(out.total).toBe(expected * qty)
    expect(out.promotionId).toBe(promoId)
  })

  it('las filas en cualquier orden dan lo mismo', async () => {
    vi.setSystemTime(new Date('2026-11-25T15:00:00Z'))
    const { result } = await load([volume({}, [...tiers].reverse())])
    expect(price(5, result.current).price).toBe(1200)
    expect(price(7, result.current).price).toBe(1000)
  })
})
