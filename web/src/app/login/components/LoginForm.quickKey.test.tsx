import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const T = '724c4579-ea83-4cef-9f37-bcfbfcc12268'
const login = vi.fn()
let authError: string | null = null
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), useSearchParams: () => new URLSearchParams() }))
vi.mock('@/shared', () => ({ useAuth: () => ({ login, isLoading: false, error: authError }) }))
vi.mock('@/app/components/OmeroLogo', () => ({ OmeroLogo: () => null }))
vi.mock('./LoginForm.module.css', () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }))

const loadLoginHint = vi.fn()
const fetchLoginOptions = vi.fn()
const saveLoginHint = vi.fn(async () => {})
vi.mock('@/lib/loginHint', async (orig) => ({
  ...(await orig<typeof import('@/lib/loginHint')>()),
  loadLoginHint: () => loadLoginHint(),
  fetchLoginOptions: (t: string) => fetchLoginOptions(t),
  saveLoginHint: (h: unknown) => saveLoginHint(h),
}))

import * as device from '@/lib/deviceSession'
import { LoginForm } from './LoginForm'

const idInput = () => screen.getByLabelText(/^Email/) as HTMLInputElement
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } })

beforeEach(() => {
  login.mockReset()
  authError = null
  loadLoginHint.mockReset()
  fetchLoginOptions.mockReset()
  saveLoginHint.mockClear()
  fetchLoginOptions.mockResolvedValue(null) // sin conexión por defecto
  vi.spyOn(device, 'fetchDeviceInfo').mockResolvedValue({ desktop: false, hasDevice: false, sessionActive: false })
})
afterEach(() => vi.restoreAllMocks())

describe('<LoginForm /> login con clave numérica', () => {
  it('primera vez en la caja (sin tenant guardado): solo email + contraseña', async () => {
    loadLoginHint.mockResolvedValue(null)
    render(<LoginForm />)
    await waitFor(() => expect(loadLoginHint).toHaveBeenCalled())
    expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email')
    type(idInput(), '12345678')
    expect(screen.getByLabelText('Contraseña')).toBeInTheDocument()
    expect(screen.queryByTestId('key-mode-hint')).not.toBeInTheDocument()
  })

  it('negocio sin la opción: una clave de 8 dígitos NO oculta la contraseña', async () => {
    loadLoginHint.mockResolvedValue({ tenantId: T, quickKeyLoginEnabled: false })
    render(<LoginForm />)
    await waitFor(() => expect(fetchLoginOptions).toHaveBeenCalledWith(T))
    type(idInput(), '12345678')
    expect(screen.getByLabelText('Contraseña')).toBeInTheDocument()
  })

  it('con la opción: parece email → muestra contraseña; parece clave → la oculta y envía tenantId + clave', async () => {
    loadLoginHint.mockResolvedValue({ tenantId: T, quickKeyLoginEnabled: true })
    render(<LoginForm />)
    expect(await screen.findByLabelText('Email o clave')).toHaveAttribute('type', 'text')

    type(idInput(), 'cajero@negocio.com')
    expect(screen.getByLabelText('Contraseña')).toBeInTheDocument()

    type(idInput(), '12345') // incompleta: todavía no es clave
    expect(screen.getByLabelText('Contraseña')).toBeInTheDocument()

    type(idInput(), '12345678')
    expect(screen.queryByLabelText('Contraseña')).not.toBeInTheDocument()
    expect(screen.getByTestId('key-mode-hint')).toBeInTheDocument()

    fireEvent.submit(idInput().closest('form')!)
    await waitFor(() => expect(login).toHaveBeenCalledWith({ tenantId: T, key: '12345678', redirectTo: undefined }))
  })

  it('con la opción y un email, el submit sigue siendo email + contraseña', async () => {
    loadLoginHint.mockResolvedValue({ tenantId: T, quickKeyLoginEnabled: true })
    render(<LoginForm />)
    await screen.findByLabelText('Email o clave')
    type(idInput(), 'cajero@negocio.com')
    type(screen.getByLabelText('Contraseña'), 'secreto123')
    fireEvent.submit(idInput().closest('form')!)
    await waitFor(() => expect(login).toHaveBeenCalledWith({ email: 'cajero@negocio.com', password: 'secreto123', redirectTo: undefined }))
  })

  it('refresca el flag con el backend: si el negocio la apagó, vuelve al modo email y lo recuerda', async () => {
    loadLoginHint.mockResolvedValue({ tenantId: T, quickKeyLoginEnabled: true })
    fetchLoginOptions.mockResolvedValue({ quickKeyLoginEnabled: false, quickKeyMinLength: 6, quickKeyMaxLength: 10 })
    render(<LoginForm />)
    await waitFor(() => expect(saveLoginHint).toHaveBeenCalledWith({ tenantId: T, quickKeyLoginEnabled: false }))
    expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email')
  })

  it('sin conexión usa el último valor conocido (sigue ofreciendo la clave)', async () => {
    loadLoginHint.mockResolvedValue({ tenantId: T, quickKeyLoginEnabled: true })
    fetchLoginOptions.mockResolvedValue(null)
    render(<LoginForm />)
    expect(await screen.findByLabelText('Email o clave')).toBeInTheDocument()
    expect(saveLoginHint).not.toHaveBeenCalled()
  })

  it('usa los largos que informa el backend', async () => {
    loadLoginHint.mockResolvedValue({ tenantId: T, quickKeyLoginEnabled: true })
    fetchLoginOptions.mockResolvedValue({ quickKeyLoginEnabled: true, quickKeyMinLength: 4, quickKeyMaxLength: 4 })
    render(<LoginForm />)
    await waitFor(() => expect(fetchLoginOptions).toHaveBeenCalled())
    await screen.findByLabelText('Email o clave')
    await waitFor(() => { type(idInput(), '1234'); expect(screen.queryByLabelText('Contraseña')).not.toBeInTheDocument() })
  })
})
