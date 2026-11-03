import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const replace = vi.fn()
let params = new URLSearchParams()
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, push: vi.fn() }), useSearchParams: () => params }))
const confirmReplaceSession = vi.fn(async () => {})
const dismissSessionConflict = vi.fn()
let conflict: { lastSeenAt?: string } | null = null
vi.mock('@/shared', () => ({
  useAuth: () => ({ login: vi.fn(), isLoading: false, error: null, sessionConflict: conflict, confirmReplaceSession, dismissSessionConflict }),
}))
vi.mock('@/app/components/OmeroLogo', () => ({ OmeroLogo: () => null }))
vi.mock('./LoginForm.module.css', () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }))

import * as device from '@/lib/deviceSession'
import { LoginForm } from './LoginForm'

beforeEach(() => {
  params = new URLSearchParams()
  conflict = null
  replace.mockClear(); confirmReplaceSession.mockClear(); dismissSessionConflict.mockClear()
  vi.spyOn(device, 'fetchDeviceInfo').mockResolvedValue({ desktop: false, hasDevice: false, sessionActive: false })
})
afterEach(() => vi.restoreAllMocks())

describe('<LoginForm /> modo web', () => {
  it.each([
    ['replaced', 'Tu sesión se cerró porque se inició en otro lugar.'],
    ['expired', 'Tu sesión venció. Ingresá de nuevo.'],
  ])('?reason=%s muestra el aviso en español', async (reason, text) => {
    params = new URLSearchParams(`reason=${reason}`)
    render(<LoginForm />)
    expect(await screen.findByTestId('login-reason')).toHaveTextContent(text)
  })

  it('con 409 SESSION_ACTIVE muestra el modal y sus botones llaman al contexto', async () => {
    conflict = { lastSeenAt: '2026-11-02T10:00:00Z' }
    render(<LoginForm />)
    expect(await screen.findByText('Ya hay una sesión abierta')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar la otra y continuar' }))
    expect(confirmReplaceSession).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(dismissSessionConflict).toHaveBeenCalled()
  })

  it('sin conflicto no hay modal; y en web no se intenta ninguna renovación de caja', async () => {
    const renew = vi.spyOn(device, 'renewSession')
    render(<LoginForm />)
    await waitFor(() => expect(device.fetchDeviceInfo).toHaveBeenCalled())
    expect(screen.queryByText('Ya hay una sesión abierta')).toBeNull()
    expect(renew).not.toHaveBeenCalled()
  })

  it('con caja registrada y sin conflicto: el modal no aparece y se renueva con la caja (como antes)', async () => {
    vi.spyOn(device, 'fetchDeviceInfo').mockResolvedValue({ desktop: true, hasDevice: true, sessionActive: true })
    vi.spyOn(device, 'renewSession').mockResolvedValue({ ok: true, user: {} as never })
    render(<LoginForm />)
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'))
    expect(screen.queryByText('Ya hay una sesión abierta')).toBeNull()
  })
})
