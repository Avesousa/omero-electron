import { afterEach, describe, expect, it, vi } from 'vitest'
import * as client from '@/lib/apiClient'
import { collectCredit, fetchCustomerDetail, fetchCustomers, quickCreateCustomer } from './customersApi'

afterEach(() => vi.restoreAllMocks())
const mockApi = (r: unknown) => vi.spyOn(client, 'apiFetch').mockResolvedValue(r as never)

describe('customersApi (POS)', () => {
  it('la lista pide SOLO la variante cacheada (?onlyActive=true)', async () => {
    const spy = mockApi({ success: true, data: [] })
    await fetchCustomers()
    expect(spy).toHaveBeenCalledWith('/api/customers?onlyActive=true')
  })

  it('traduce los códigos del backend a español', async () => {
    mockApi({ success: false, error: 'Customer not found', code: 'CUSTOMER_NOT_FOUND' })
    const r = await fetchCustomers()
    expect(r).toMatchObject({ success: false, error: 'El cliente no existe. Recargá la pantalla.' })
  })

  it('alta rápida: sin conexión devuelve un error claro (no hay alta offline)', async () => {
    mockApi({ success: false, error: 'No se pudo conectar con el servidor.' })
    expect(await quickCreateCustomer({})).toMatchObject({ success: false, error: expect.stringContaining('Sin conexión: no se puede crear un cliente nuevo') })
    vi.restoreAllMocks()
    vi.spyOn(client, 'apiFetch').mockRejectedValue(new Error('boom'))
    expect(await quickCreateCustomer({ name: 'x' })).toMatchObject({ success: false, error: expect.stringContaining('Sin conexión') })
  })

  it('alta rápida online manda el cuerpo tal cual', async () => {
    const spy = mockApi({ success: true, data: { id: '1' } })
    await quickCreateCustomer({ name: 'Ana' })
    expect(spy).toHaveBeenCalledWith('/api/customers/quick', { method: 'POST', body: JSON.stringify({ name: 'Ana' }) })
  })

  it('detalle sin conexión y sin caché: mensaje claro en español', async () => {
    mockApi({ success: false, error: 'El servidor tardó demasiado en responder.' })
    expect(await fetchCustomerDetail('abc')).toMatchObject({ success: false, error: expect.stringContaining('Sin conexión: no hay datos guardados') })
  })

  it('cobro: POST /api/credit/collect con el cuerpo del cobro', async () => {
    const spy = mockApi({ success: true, data: { queued: true, debtAfter: null, duplicate: false } })
    const input = { customerId: 'c', clientId: 'k', payments: [{ paymentMethodId: 'm', amount: 5 }], expectedDebt: 5 }
    await collectCredit(input)
    expect(spy).toHaveBeenCalledWith('/api/credit/collect', { method: 'POST', body: JSON.stringify(input) })
  })
})
