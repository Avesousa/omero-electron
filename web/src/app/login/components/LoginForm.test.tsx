import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const replace = vi.fn()
let params = new URLSearchParams()
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, push: vi.fn() }), useSearchParams: () => params }))
vi.mock('@/shared', () => ({ useAuth: () => ({ login: vi.fn(), isLoading: false, error: null }) }))
vi.mock('@/app/components/OmeroLogo', () => ({ OmeroLogo: () => null }))
// El CSS module pasa por PostCSS/Tailwind (no se necesita para estas pruebas)
vi.mock('./LoginForm.module.css', () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }))

import * as device from '@/lib/deviceSession'
import { LoginForm } from './LoginForm'

beforeEach(() => {
  replace.mockClear()
  params = new URLSearchParams()
  vi.spyOn(device, 'fetchDeviceInfo').mockResolvedValue({ desktop: true, hasDevice: true, sessionActive: true })
})

afterEach(() => vi.restoreAllMocks())

describe('<LoginForm /> renovación silenciosa (desktop con caja)', () => {
  it('con la sesión vencida renueva sola y vuelve a donde estaba, sin pedir credenciales', async () => {
    params = new URLSearchParams('redirectTo=/pos')
    vi.spyOn(device, 'renewSession').mockResolvedValue({ ok: true, user: {} as never })
    render(<LoginForm />)
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/pos'))
  })

  it('sin redirectTo válido vuelve al inicio', async () => {
    params = new URLSearchParams('redirectTo=https://evil.example')
    vi.spyOn(device, 'renewSession').mockResolvedValue({ ok: true, user: {} as never })
    render(<LoginForm />)
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'))
  })

  it('muestra "Renovando sesión…" mientras espera', async () => {
    let done!: () => void
    vi.spyOn(device, 'renewSession').mockImplementation(() => new Promise((r) => (done = () => r({ ok: false, code: 'UNAVAILABLE', message: '' }))))
    render(<LoginForm />)
    expect(await screen.findByTestId('renewing-session')).toBeInTheDocument()
    done()
    await waitFor(() => expect(screen.queryByTestId('renewing-session')).not.toBeInTheDocument())
  })

  it.each([
    ['DEVICE_REVOKED', /revocada/], ['DEVICE_EXPIRED', /venció por inactividad/], ['LOGIN_REQUIRED', /Iniciá sesión para seguir/],
  ] as const)('si no se puede renovar (%s) muestra el motivo y deja el formulario', async (code, text) => {
    vi.spyOn(device, 'renewSession').mockResolvedValue({ ok: false, code, message: '' })
    render(<LoginForm />)
    expect(await screen.findByTestId('login-reason')).toHaveTextContent(text)
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()
  })

  it('sin red (UNAVAILABLE) no muestra motivo: solo el login normal', async () => {
    vi.spyOn(device, 'renewSession').mockResolvedValue({ ok: false, code: 'UNAVAILABLE', message: '' })
    render(<LoginForm />)
    await waitFor(() => expect(device.renewSession).toHaveBeenCalled())
    expect(screen.queryByTestId('login-reason')).not.toBeInTheDocument()
  })

  it('llegó con ?reason= (revocada/vencida): muestra el motivo y NO intenta renovar', async () => {
    params = new URLSearchParams('reason=device-revoked')
    const renew = vi.spyOn(device, 'renewSession')
    render(<LoginForm />)
    expect(screen.getByTestId('login-reason')).toHaveTextContent(/revocada/)
    await Promise.resolve()
    expect(renew).not.toHaveBeenCalled()
  })

  it.each([
    ['web', { desktop: false, hasDevice: false, sessionActive: false }],
    ['sin caja registrada', { desktop: true, hasDevice: false, sessionActive: false }],
    ['tras un logout explícito', { desktop: true, hasDevice: true, sessionActive: false }],
  ])('%s: no renueva (login de siempre)', async (_n, info) => {
    vi.spyOn(device, 'fetchDeviceInfo').mockResolvedValue(info)
    const renew = vi.spyOn(device, 'renewSession')
    render(<LoginForm />)
    await waitFor(() => expect(device.fetchDeviceInfo).toHaveBeenCalled())
    await Promise.resolve()
    expect(renew).not.toHaveBeenCalled()
    expect(screen.queryByTestId('renewing-session')).not.toBeInTheDocument()
    expect(screen.queryByTestId('login-reason')).not.toBeInTheDocument()
  })
})
