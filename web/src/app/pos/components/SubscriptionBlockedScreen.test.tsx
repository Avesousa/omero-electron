import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { SubscriptionBlockedScreen } from './SubscriptionBlockedScreen'

describe('SubscriptionBlockedScreen', () => {
  it('no muestra nada cerrada', () => {
    render(<SubscriptionBlockedScreen isOpen={false} onRetry={vi.fn()} onLogout={vi.fn()} />)
    expect(screen.queryByTestId('subscription-blocked')).toBeNull()
  })

  it('muestra el mensaje, sin botón de cerrar, y permite reintentar o cerrar sesión', () => {
    const onRetry = vi.fn()
    const onLogout = vi.fn()
    render(<SubscriptionBlockedScreen isOpen onRetry={onRetry} onLogout={onLogout} />)
    expect(screen.getByText('La suscripción del negocio venció. Comunicate con el administrador.')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByTestId('subscription-blocked')).toBeTruthy() // Esc no la cierra
    fireEvent.click(screen.getByText('Reintentar'))
    fireEvent.click(screen.getByText('Cerrar sesión'))
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onLogout).toHaveBeenCalledTimes(1)
  })
})
