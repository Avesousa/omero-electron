import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import * as api from '@/lib/customersApi'
import { useCustomers } from '../useCustomers'
import { useCustomerPicker } from '../useCustomerPicker'
import type { Customer } from '@/shared/types/credit'

const c = (code: number): Customer => ({ id: `id${code}`, code, name: `C${code}`, active: true, extra: {}, debt: 0, pendingLines: 0, oldestPendingAt: null, createdAt: '' })
afterEach(() => vi.restoreAllMocks())

describe('useCustomers', () => {
  it('sin permiso no pide nada', async () => {
    const spy = vi.spyOn(api, 'fetchCustomers')
    renderHook(() => useCustomers(false))
    await act(async () => {})
    expect(spy).not.toHaveBeenCalled()
  })

  it('carga la lista y la alta rápida agrega el cliente nuevo', async () => {
    vi.spyOn(api, 'fetchCustomers').mockResolvedValue({ success: true, data: [c(1)] })
    const quick = vi.spyOn(api, 'quickCreateCustomer').mockResolvedValue({ success: true, data: c(2) })
    const { result } = renderHook(() => useCustomers(true))
    await waitFor(() => expect(result.current.customers).toHaveLength(1))
    let r: Awaited<ReturnType<typeof result.current.quickCreate>> | undefined
    await act(async () => { r = await result.current.quickCreate('  ') })
    expect(quick).toHaveBeenCalledWith({}) // sin nombre: el backend pone «Cliente N»
    expect(r?.customer?.code).toBe(2)
    expect(result.current.customers.map(x => x.code)).toEqual([1, 2])
  })

  it('el alta rápida fallida devuelve el error en español sin tocar la lista', async () => {
    vi.spyOn(api, 'fetchCustomers').mockResolvedValue({ success: true, data: [c(1)] })
    vi.spyOn(api, 'quickCreateCustomer').mockResolvedValue({ success: false, error: 'Sin conexión: no se puede crear un cliente nuevo ahora.' })
    const { result } = renderHook(() => useCustomers(true))
    await waitFor(() => expect(result.current.customers).toHaveLength(1))
    let r: { error?: string } | undefined
    await act(async () => { r = await result.current.quickCreate('Ana') })
    expect(r?.error).toMatch(/Sin conexión/)
    expect(result.current.customers).toHaveLength(1)
  })
})

describe('useCustomerPicker', () => {
  it('dígitos filtran, Backspace borra y Enter elige solo si queda uno', () => {
    const { result } = renderHook(() => useCustomerPicker([c(7), c(70), c(42)]))
    act(() => { result.current.pressKey('7') })
    expect(result.current.matches).toHaveLength(2)
    let picked: Customer | null = null
    act(() => { picked = result.current.pressKey('Enter') })
    expect(picked).toBeNull()
    act(() => { result.current.pressKey('0') })
    act(() => { picked = result.current.pressKey('Enter') })
    expect((picked as Customer | null)?.code).toBe(70)
    act(() => { result.current.pressKey('Backspace') })
    expect(result.current.query).toBe('7')
  })
})
